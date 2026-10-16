"""Homelab AI gateway for Personal OS V2. One port, bearer-token checked.

  POST /v1/audio/transcriptions -> LFM2.5-Audio-1.5B ASR, OpenAI response shape {"text": ...}
  /v1/systemone*                -> proxied to laya-serve (the app's classifier, AI_CLASSIFIER=laya)
  anything else                 -> proxied to Ollama (the app's chat + embeddings path)

Env: LOCAL_AI_TOKEN (required), PORT (default 8090), OLLAMA_URL (default http://127.0.0.1:11434),
     LAYA_URL (default http://127.0.0.1:8000)
Run: ~/venvs/lfm-audio/bin/python ai_gateway.py   (needs ffmpeg on PATH)
"""
import hmac, json, os, subprocess, threading, urllib.error, urllib.request
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
from liquid_audio import ChatState, LFM2AudioModel, LFM2AudioProcessor

TOKEN = os.environ["LOCAL_AI_TOKEN"].encode()
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
LAYA = os.environ.get("LAYA_URL", "http://127.0.0.1:8000").rstrip("/")
PORT = int(os.environ.get("PORT", "8090"))
REPO = "LiquidAI/LFM2.5-Audio-1.5B"
MAX_BODY = 25 * 1024 * 1024  # same cap as OpenAI's transcription endpoint

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
processor = LFM2AudioProcessor.from_pretrained(REPO, device=DEVICE).eval()
model = LFM2AudioModel.from_pretrained(REPO, device=DEVICE).eval()
gpu = threading.Lock()  # ponytail: one transcription at a time; queue is fine for one user


def decode_audio(data: bytes) -> torch.Tensor:
    # ffmpeg reads anything (Telegram .ogg/opus, iOS .m4a, wav, mp3) -> 16 kHz mono float32
    pcm = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", "pipe:0", "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"],
        input=data, capture_output=True, check=True, timeout=120,
    ).stdout
    return torch.from_numpy(np.frombuffer(pcm, dtype=np.float32).copy()).unsqueeze(0)


def transcribe(data: bytes) -> str:
    chat = ChatState(processor)
    chat.new_turn("system"); chat.add_text("Perform ASR."); chat.end_turn()
    chat.new_turn("user"); chat.add_audio(decode_audio(data), 16_000); chat.end_turn()
    chat.new_turn("assistant")
    out = []
    with gpu:
        for t in model.generate_sequential(**chat, max_new_tokens=1024):
            if t.numel() != 1:
                continue  # audio-out codes; ASR only wants text
            piece = processor.text.decode(t)
            if piece == "<|im_end|>":
                break
            out.append(piece)
    return "".join(out).strip()


def file_from_multipart(content_type: str, body: bytes) -> bytes | None:
    msg = BytesParser(policy=HTTP).parsebytes(b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + body)
    for part in msg.iter_parts():
        if part.get_param("name", header="content-disposition") == "file":
            return part.get_payload(decode=True)
    return None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, code: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_any(self) -> None:
        auth = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(auth, b"Bearer " + TOKEN):
            return self.reply(401, b'{"error":"unauthorized"}')
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self.reply(413, b'{"error":"too large"}')
        body = self.rfile.read(length) if length else b""

        if self.command == "POST" and self.path.split("?")[0].rstrip("/") == "/v1/audio/transcriptions":
            audio = file_from_multipart(self.headers.get("Content-Type", ""), body)
            if not audio:
                return self.reply(400, b'{"error":"multipart field \\"file\\" required"}')
            try:
                text = transcribe(audio)
            except subprocess.CalledProcessError:
                return self.reply(400, b'{"error":"could not decode audio"}')
            return self.reply(200, json.dumps({"text": text}).encode())

        # ponytail: buffered proxy, no streaming; the app calls Ollama with stream:false
        laya = self.path.split("?")[0].startswith("/v1/systemone")
        upstream, name = (LAYA, "laya") if laya else (OLLAMA, "ollama")
        req = urllib.request.Request(upstream + self.path, data=body or None, method=self.command,
                                     headers={"Content-Type": self.headers.get("Content-Type", "application/json")})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                self.reply(r.status, r.read(), r.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as e:
            self.reply(e.code, e.read(), e.headers.get("Content-Type", "application/json"))
        except urllib.error.URLError:
            self.reply(502, json.dumps({"error": f"{name} unreachable"}).encode())

    do_GET = do_POST = do_DELETE = handle_any


if __name__ == "__main__":
    print(f"ai_gateway on 127.0.0.1:{PORT} ({DEVICE})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
