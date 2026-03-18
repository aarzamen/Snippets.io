# Snippets Local

A local code editor with live preview and AI-powered tools, running inference on Apple Silicon via MLX.

## Quickstart

```bash
pip install mlx-lm aiohttp huggingface-hub
python3 snippets-launcher.py
# Editor opens at http://localhost:3000
```

## Features

- **Live Preview** — See your HTML/CSS/JS rendered in real-time with Portrait, Landscape, and Desktop modes
- **AI Tools** — Optimize, Fix Bugs, Add Comments, and Format code using a local LLM
- **Snippet Library** — Save and manage multiple snippets in localStorage
- **Console** — Capture console.log/warn/error from your preview
- **Dark/Light Mode** — Toggle between themes
- **Export** — Download as HTML or copy to clipboard
- **Zero Cloud Dependencies** — Everything runs locally on your Mac

## CLI Options

```
--model    HuggingFace model repo ID (default: mlx-community/Llama-3.2-3B-Instruct-4bit)
--port     HTTP server port (default: 3000)
--mlx-port MLX server port (default: 8080)
--check    Run health check and exit
--no-browser  Don't auto-open browser
```

## Requirements

- macOS with Apple Silicon (M1/M2/M3/M4)
- Python 3.10+
- 16GB+ RAM recommended
