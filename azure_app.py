"""Serve the browser edition of Focus Studio on Azure App Service."""

from pathlib import Path

from flask import Flask, send_file

app = Flask(__name__, static_folder=None)
INDEX = Path(__file__).with_name("index.html")


@app.get("/")
@app.get("/index.html")
def index():
    return send_file(INDEX, conditional=True)


@app.get("/healthz")
def health():
    return {"status": "ok"}
