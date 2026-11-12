#!/usr/bin/env python3
"""ComfyUI Ernie Generator — FastAPI HTTP server."""

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import shared

# ── Config ───────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent
VERSION = shared.VERSION

# Port the Image Browser+ app listens on (matches launcher-dashboard's app entry).
IMAGE_BROWSER_PORT = int(os.environ.get("IMAGE_BROWSER_PORT", "5000"))

# ── User settings persistence ──────────────────────────────────────
USER_SETTINGS_PATH = os.path.join(PROJECT_ROOT, "user_settings.json")


def _load_user_settings():
    if os.path.exists(USER_SETTINGS_PATH):
        try:
            with open(USER_SETTINGS_PATH, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {"model_settings": {}}


def _save_user_settings(settings):
    try:
        with open(USER_SETTINGS_PATH, "w") as f:
            json.dump(settings, f, indent=2)
    except Exception as e:
        print(f"[WARN] Could not save user settings: {e}")


def _load_system_settings():
    settings = _load_user_settings()
    return settings.get("system_settings", {})


def _load_ui_state():
    """Small per-user UI preferences (last selected model, generation mode)."""
    return _load_user_settings().get("ui_state", {})


def _save_ui_state(updates):
    settings = _load_user_settings()
    ui_state = settings.get("ui_state", {})
    ui_state.update({k: v for k, v in updates.items() if v})
    settings["ui_state"] = ui_state
    _save_user_settings(settings)
    return ui_state


def _save_system_settings(system_settings):
    settings = _load_user_settings()
    settings["system_settings"] = system_settings
    _save_user_settings(settings)


def _migrate_legacy_settings(settings):
    """Migrate old flat LoRA-only structure to new per-model, per-mode nested structure."""
    ms = settings.get("model_settings", {})
    migrated = False
    for model, data in list(ms.items()):
        if model == "chain":
            continue
        if isinstance(data, dict) and (
            "t2i" not in data and "i2i" not in data and "chain" not in data
        ):
            preset = shared.get_preset(model)
            ms[model] = {
                "t2i": {**preset, "denoise": 1.0},
                "i2i": {**preset, "denoise": 0.8},
                "chain": {
                    "stage1": {"unet_name": model, "denoise": 1.0},
                    "stage2": {"unet_name": model, "denoise": 0.5},
                },
            }
            for mode in ("t2i", "i2i"):
                for key in (
                    "lora1_name",
                    "lora1_strength",
                    "lora2_name",
                    "lora2_strength",
                ):
                    if key in data:
                        ms[model][mode][key] = data[key]
            migrated = True
    if migrated:
        print(
            "[MIGRATE] Converted legacy user_settings.json to per-model, per-mode format"
        )
    return settings


def get_model_defaults(unet_name, mode="t2i"):
    settings = _load_user_settings()
    settings = _migrate_legacy_settings(settings)
    preset = shared.get_preset(unet_name)
    base = {**preset, "denoise": 1.0 if mode == "t2i" else 0.8}
    overrides = settings.get("model_settings", {}).get(unet_name, {}).get(mode, {})
    return {**base, **overrides}


def save_model_defaults(unet_name, mode, defaults):
    settings = _load_user_settings()
    settings = _migrate_legacy_settings(settings)
    if "model_settings" not in settings:
        settings["model_settings"] = {}
    if unet_name not in settings["model_settings"]:
        settings["model_settings"][unet_name] = {}
    settings["model_settings"][unet_name][mode] = defaults
    _save_user_settings(settings)


_CHAIN_PRESETS = {
    "forward": {
        "stage1": {
            "unet_name": "z_image_turbo_bf16.safetensors",
            "denoise": 1.0,
            "mp": 1.54,
            "ar": "9:16",
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "zturbo/char/K@te_20260211104109.safetensors",
            "lora1_strength": 0.6,
            "lora2_name": "zturbo/style/JabZ - ZIT .safetensors",
            "lora2_strength": 0.35,
        },
        "stage2": {
            "unet_name": "qwen_image_2.1_int8_convrot.safetensors",
            "denoise": 1.0,
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 25,
            "cfg": 1.0,
            "lora1_name": "none",
            "lora1_strength": 0.0,
            "lora2_name": "none",
            "lora2_strength": 0.0,
            "upscale": 1.0,
        },
    },
    "reversed": {
        "stage1": {
            "unet_name": "ernie-image-turbo.safetensors",
            "denoise": 1.0,
            "mp": 1.54,
            "ar": "9:16",
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "ernie/ernie-anime-v1.safetensors",
            "lora1_strength": 0.35,
            "lora2_name": "none",
            "lora2_strength": 0.0,
        },
        "stage2": {
            "unet_name": "z_image_turbo_bf16.safetensors",
            "denoise": 0.5,
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "zturbo/char/K@te_20260211104109.safetensors",
            "lora1_strength": 0.6,
            "lora2_name": "zturbo/style/JabZ - ZIT .safetensors",
            "lora2_strength": 0.35,
            "upscale": 1.0,
        },
    },
    "ernie_to_krea2": {
        "stage1": {
            "unet_name": "ernie-image-turbo.safetensors",
            "denoise": 1.0,
            "mp": 1.54,
            "ar": "9:16",
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "ernie/ernie-anime-v1.safetensors",
            "lora1_strength": 0.35,
            "lora2_name": "none",
            "lora2_strength": 0.0,
        },
        "stage2": {
            "unet_name": "krea2_turbo_fp8_scaled.safetensors",
            "denoise": 0.5,
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "none",
            "lora1_strength": 0.0,
            "lora2_name": "none",
            "lora2_strength": 0.0,
            "upscale": 1.0,
        },
    },
    "krea2_to_ernie": {
        "stage1": {
            "unet_name": "krea2_turbo_fp8_scaled.safetensors",
            "denoise": 1.0,
            "mp": 1.54,
            "ar": "9:16",
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "none",
            "lora1_strength": 0.0,
            "lora2_name": "none",
            "lora2_strength": 0.0,
        },
        "stage2": {
            "unet_name": "ernie-image-turbo.safetensors",
            "denoise": 0.5,
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "ernie/ernie-anime-v1.safetensors",
            "lora1_strength": 0.35,
            "lora2_name": "none",
            "lora2_strength": 0.0,
            "upscale": 1.0,
        },
    },
    "ernie_upscale": {
        "stage1": {
            "unet_name": "ernie-image-turbo.safetensors",
            "denoise": 1.0,
            "mp": 1.54,
            "ar": "9:16",
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "ernie/ernie-anime-v1.safetensors",
            "lora1_strength": 0.35,
            "lora2_name": "none",
            "lora2_strength": 0.0,
        },
        "stage2": {
            "unet_name": "ernie-image-turbo.safetensors",
            "denoise": 0.5,
            "sampler": "euler",
            "scheduler": "simple",
            "steps": 8,
            "cfg": 1.0,
            "lora1_name": "ernie/ernie-anime-v1.safetensors",
            "lora1_strength": 0.35,
            "lora2_name": "none",
            "lora2_strength": 0.0,
            "upscale": 1.35,
        },
    },
}


def get_chain_defaults(direction="forward"):
    settings = _load_user_settings()
    settings = _migrate_legacy_settings(settings)
    stored = settings.get("model_settings", {}).get("chain", {})
    if direction in stored:
        return stored[direction]
    return _CHAIN_PRESETS.get(direction, _CHAIN_PRESETS["forward"])


def save_chain_defaults(direction, stage1, stage2):
    settings = _load_user_settings()
    settings = _migrate_legacy_settings(settings)
    if "model_settings" not in settings:
        settings["model_settings"] = {}
    if "chain" not in settings["model_settings"]:
        settings["model_settings"]["chain"] = {}
    settings["model_settings"]["chain"][direction] = {
        "stage1": stage1,
        "stage2": stage2,
    }
    _save_user_settings(settings)


def get_model_user_settings(unet_name, mode="t2i"):
    """Legacy compatibility — returns defaults for the requested mode."""
    defaults = get_model_defaults(unet_name, mode)
    return {
        "lora1_name": defaults.get("lora1_name", "none"),
        "lora1_strength": defaults.get("lora1_strength", 0.0),
        "lora2_name": defaults.get("lora2_name", "none"),
        "lora2_strength": defaults.get("lora2_strength", 0.0),
    }


def save_model_user_settings(
    unet_name, lora1_name, lora1_strength, lora2_name, lora2_strength, mode="t2i"
):
    """Legacy compatibility — saves LoRA overrides into per-mode defaults."""
    defaults = get_model_defaults(unet_name, mode)
    defaults.update(
        {
            "lora1_name": lora1_name,
            "lora1_strength": lora1_strength,
            "lora2_name": lora2_name,
            "lora2_strength": lora2_strength,
        }
    )
    save_model_defaults(unet_name, mode, defaults)


# ── Generation timing tracking ────────────────────────────────────
_generation_meta = {}  # prompt_id -> {"start": time.time(), "snapshot": {...}}
# Resized I2I inputs live in ComfyUI's input dir and must survive until the queued job has
# actually loaded them — /prompt only queues, it does not load. Deleting them on submit made
# a busy queue fail with "av.error.FileNotFoundError: ..._resized.png"; drop them when the
# job reports done/error in /api/status instead.
_resized_inputs = {}  # prompt_id -> [paths]


def _drop_resized(prompt_id: str) -> None:
    for path in _resized_inputs.pop(prompt_id, []) or []:
        try:
            os.remove(path)
        except OSError:
            pass


def _prune_resized(max_age: float = 6 * 3600) -> None:
    """Safety net: forget resized inputs nobody polled for (engine closed mid-job)."""
    now = time.time()
    for pid in list(_resized_inputs):
        meta = _generation_meta.get(pid) or {}
        if now - meta.get("start", now) > max_age:
            _drop_resized(pid)
    _sweep_resized_files()


_RESIZED_SWEEP_EVERY = 3600
_last_resized_sweep = 0.0


def _sweep_resized_files(max_age: float = 24 * 3600, force: bool = False) -> int:
    """Remove `*_resized*` files in ComfyUI's input dir older than `max_age`.

    `_resized_inputs` is process memory, so a restart orphans every path registered before it and
    `_drop_resized` can never reach them again (61 such files were sitting in the input dir before
    this existed). They are scratch copies — the uploaded source is untouched — so age is the only
    thing to judge them by. Throttled: one directory scan an hour, plus one forced at startup.
    """
    global _last_resized_sweep
    now = time.time()
    if not force and now - _last_resized_sweep < _RESIZED_SWEEP_EVERY:
        return 0
    _last_resized_sweep = now
    removed = 0
    try:
        names = os.listdir(shared.COMFY_INPUT_DIR)
    except OSError:
        return 0
    cutoff = now - max_age
    for name in names:
        if "_resized" not in name:
            continue
        path = os.path.join(shared.COMFY_INPUT_DIR, name)
        try:
            if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError:
            pass
    if removed:
        print(f"[CLEANUP] removed {removed} orphaned resized input(s)")
    return removed
_last_durations = []  # rolling window of last 5 successful generation times


# ── Pydantic models ──────────────────────────────────────────────


class GenerateRequest(BaseModel):
    positive_prompt: str
    generation_mode: str = "T2I"
    input_image_filename: Optional[str] = None
    # Extra references (image_2 .. image_N) for the Qwen-Image 2.1 multi-image edit.
    reference_images: Optional[List[str]] = None
    dimension_mode: str = "Direct"
    mp: float = 1.54
    ar: str = "9:16"
    width: int = 832
    height: int = 1664
    seed: int = 42
    denoise: float = 1.0
    steps: int = 8
    cfg: float = 1.0
    scheduler: str = "simple"
    sampler: str = "euler"
    lora1_name: str = "none"
    lora1_strength: float = 0.35
    lora2_name: str = "none"
    lora2_strength: float = 0.0
    unet_name: str = "qwen_image_2.1_int8_convrot.safetensors"
    clip_name: str = "qwen3vl_8b_int8_convrot.safetensors"
    clip_type: str = "qwen_image"
    vae_name: str = "qwen_image_2.1_vae_bf16.safetensors"
    upscale: float = 1.0
    pag_scale: float = 0.0


class CalcDimensionsRequest(BaseModel):
    mp: float = 1.0
    ar: str = "9:16"


class SaveSettingsRequest(BaseModel):
    unet_name: str
    generation_mode: str = "t2i"
    lora1_name: str = "none"
    lora1_strength: float = 0.0
    lora2_name: str = "none"
    lora2_strength: float = 0.0


class DefaultsRequest(BaseModel):
    action: str = "load"
    unet_name: str = ""
    mode: str = "t2i"
    direction: str = "forward"
    defaults: Dict[str, Any] = Field(default_factory=dict)
    chain: Dict[str, Any] = Field(default_factory=dict)


class SystemSettingsRequest(BaseModel):
    comfy_root: str = ""
    comfy_python: str = ""
    output_dir: str = ""
    loras_root: str = ""
    comfy_host: str = ""


class UiStateRequest(BaseModel):
    last_unet: str = ""
    generation_mode: str = ""


# The only keys a per-model/per-mode entry is meant to hold. Everything else in
# get_model_defaults()' response is either the shipped preset's own metadata
# (unet_loader, latent_channels) or the full LoRA catalogue ("loras"), which the
# UI re-reads from /api/models anyway — writing those into user_settings.json
# bloated the file with ~80 LoRA paths on every save.
PERSISTED_DEFAULT_KEYS = (
    "sampler", "scheduler", "steps", "cfg", "denoise", "mp", "ar",
    "clip_name", "clip_type", "vae_name",
    "lora1_name", "lora1_strength", "lora2_name", "lora2_strength",
    "pag_scale",
)


class ProcessImageRequest(BaseModel):
    filename: str = ""
    shadows: int = 0
    highlights: int = 255
    output_min: int = 0
    output_max: int = 255
    contrast: float = 1.0
    saturation: float = 1.0
    temperature: int = 0
    brilliance: float = 1.0
    tint: int = 0
    vignette_exposure: float = 0
    vignette_hardness: float = 0.5
    vignette_scale: float = 1.0
    vignette_shape: float = 1.0  # 0.0 = vertical line, 1.0 = circle, 2.0 = horizontal line
    save_mode: str = "copy"  # "copy" or "overwrite"


# ── App init ───────────────────────────────────────────────────
app = FastAPI(title="ComfyUI Ernie Generator", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load persisted system paths first, then launch ComfyUI
_persisted = _load_system_settings()
if _persisted:
    shared.reload_paths(_persisted)
    print(f"[PATHS] Loaded persisted system settings from {USER_SETTINGS_PATH}")

_comfy_ok, _comfy_msg = shared.launch_comfyui()
print(f"[ComfyUI] {_comfy_msg}")
shared.scan_loras()


# ── API Routes ───────────────────────────────────────────────────


@app.get("/api/config")
async def handle_config():
    default_unet = shared.DEFAULT_UNET
    preset = shared.get_preset(default_unet)
    unet_info = shared.get_unet_model_info()
    # Come back to the model the user last had selected, not to model #1 —
    # a reload (or a hard refresh) should not silently change which model the
    # next Generate will use. Only honoured if it is still on disk.
    names = [m["name"] for m in unet_info]
    # A fresh clone has an empty registry: DEFAULT_UNET is "" and the app would open with no
    # model selected. Fall back to the first unet that its ComfyUI folder actually has.
    if default_unet not in names and names:
        default_unet = names[0]
        preset = shared.get_preset(default_unet)
    last_unet = _load_ui_state().get("last_unet", "")
    if last_unet and last_unet in names:
        default_unet = last_unet
        preset = shared.get_preset(default_unet)
    defaults = {}
    for model in names:
        defaults[model] = {
            "t2i": get_model_defaults(model, "t2i"),
            "i2i": get_model_defaults(model, "i2i"),
        }
    return {
        "status": "ok",
        "version": VERSION,
        "default_unet": default_unet,
        "samplers": shared.SAMPLERS,
        "schedulers": shared.SCHEDULERS,
        "unet_models": [m["name"] for m in unet_info],
        "unet_info": unet_info,
        "clip_models": shared.CLIP_MODELS,
        "clip_types": shared.CLIP_TYPES,
        "vae_models": shared.VAE_MODELS,
        "loras": shared.get_loras_for_model(default_unet),
        "preset": preset,
        "profiles": shared.PROFILES,
        "defaults": defaults,
        "chain": get_chain_defaults(),
        "paths": {
            "comfy_root": shared.COMFY_ROOT,
            "comfy_python": shared.COMFY_PYTHON,
            "output_dir": shared.OUTPUT_DIR,
            "loras_root": shared.LORAS_ROOT,
            "comfy_host": shared.COMFY_HOST,
        },
        "config_defaults": {
            "comfy_root": os.path.expanduser(shared._CFG.get("comfy_root", "~/comfy/ComfyUI")),
            "comfy_python": os.path.expanduser(shared._CFG.get("comfy_python", "~/comfy/ComfyUI/venv/bin/python")),
            "output_dir": os.path.expanduser(shared._CFG.get("output_dir", "~/comfy/ComfyUI/output")),
            "loras_root": os.path.expanduser(shared._CFG.get("loras_root", "~/comfy/ComfyUI/models/loras")),
            "comfy_host": shared._CFG.get("comfy_host", "http://localhost:8188"),
        },
    }


@app.get("/api/models")
async def handle_models(current_unet: str = "", mode: str = "t2i"):
    result = shared.refresh_models(current_unet)
    if current_unet:
        result["preset"] = get_model_defaults(current_unet, mode)
        result["user_settings"] = get_model_user_settings(current_unet, mode)
    return {"status": "ok", **result}


@app.get("/api/status")
async def handle_status(prompt_id: str = ""):
    if not prompt_id:
        return JSONResponse(
            {"status": "error", "message": "No prompt_id provided."},
            status_code=400,
        )

    # Check queue first
    try:
        req = urllib.request.Request(f"{shared.COMFY_HOST}/queue")
        resp = urllib.request.urlopen(req, timeout=10)
        queue_data = json.loads(resp.read())
        running = queue_data.get("queue_running", [])
        pending = queue_data.get("queue_pending", [])
        for item in running + pending:
            if isinstance(item, list) and len(item) > 1 and item[1] == prompt_id:
                return {
                    "status": "ok",
                    "state": "pending",
                    "queue": "running" if item in running else "pending",
                }
    except Exception:
        pass

    try:
        req = urllib.request.Request(f"{shared.COMFY_HOST}/history/{prompt_id}")
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())

        if prompt_id not in data:
            return {"status": "ok", "state": "pending"}

        job = data[prompt_id]
        if job.get("outputs"):
            outputs = job["outputs"]
            for node_id, node_out in outputs.items():
                if "images" in node_out:
                    imgs = node_out["images"]
                    if imgs:
                        output_filename = imgs[0]["filename"]
                        subfolder = imgs[0].get("subfolder", "")
                        proxy_url = f"/api/view?filename={urllib.parse.quote(output_filename)}&type=output"
                        if subfolder:
                            proxy_url += f"&subfolder={urllib.parse.quote(subfolder)}"

                        _drop_resized(prompt_id)
                        meta = _generation_meta.pop(prompt_id, None)
                        elapsed = 0.0
                        avg_str = ""
                        if meta:
                            elapsed = time.time() - meta["start"]
                            _last_durations.append(elapsed)
                            if len(_last_durations) > 5:
                                _last_durations.pop(0)
                            avg = sum(_last_durations) / len(_last_durations)
                            avg_str = f"avg {avg:.1f}s (last {len(_last_durations)})"
                            snap = meta.get("snapshot", {})
                            status_msg = (
                                f"Complete! {elapsed:.1f}s | "
                                f"{snap.get('width', '?')}x{snap.get('height', '?')}"
                            )
                            if avg_str:
                                status_msg += f" | {avg_str}"
                        else:
                            status_msg = f"Complete! {output_filename}"

                        return {
                            "status": "ok",
                            "state": "done",
                            "image_url": proxy_url,
                            "filename": output_filename,
                            "status_msg": status_msg,
                        }

        status = job.get("status", {})
        status_str = status.get("status_str", "")
        if status_str == "error":
            # Clean up generation meta and the resized input on error
            _drop_resized(prompt_id)
            _generation_meta.pop(prompt_id, None)
            messages = status.get("messages", [])
            error_msg = "ComfyUI execution error"
            for msg in messages:
                if (
                    isinstance(msg, list)
                    and len(msg) >= 2
                    and msg[0] == "execution_error"
                ):
                    exc = msg[1].get("exception_message", "")
                    if exc:
                        error_msg = exc
                    break
            return JSONResponse(
                {"status": "error", "state": "error", "message": error_msg},
                status_code=500,
            )

        return {"status": "ok", "state": "pending"}

    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.get("/api/view")
async def handle_view(filename: str, type: str = "output", subfolder: str = ""):
    if not filename:
        return JSONResponse(
            {"status": "error", "message": "No filename provided"}, status_code=400
        )

    try:
        img_url = f"{shared.COMFY_HOST}/view?filename={urllib.parse.quote(filename)}&type={type}"
        if subfolder:
            img_url += f"&subfolder={urllib.parse.quote(subfolder)}"
        req = urllib.request.Request(img_url)
        resp = urllib.request.urlopen(req, timeout=30)
        img_data = resp.read()
        content_type = resp.headers.get("Content-Type", "image/png")
        return Response(
            content=img_data,
            media_type=content_type,
            headers={"Cache-Control": "no-cache"},
        )
    except Exception as e:
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)


@app.get("/api/open_output")
def handle_open_output(request: Request):
    """Launch/reuse the Image Browser+ app and return a URL for the client to open.

    Sync on purpose: the reachability probe below is blocking, and this endpoint
    must not stall the event loop (the UI polls /api/stats continuously).
    """
    try:
        image_browser_dir = os.path.expanduser(
            shared._CFG.get("image_browser_dir",
                os.path.join(os.path.dirname(PROJECT_ROOT), "image-browser-styled"))
        )
        if not os.path.isdir(image_browser_dir):
            return JSONResponse(
                {"status": "error", "message": f"Image browser directory not found: {image_browser_dir}"},
                status_code=404,
            )

        # Reuse the launcher-managed Image Browser (port 5000) when it is already
        # serving — otherwise every click spawns a duplicate Flask server.
        port = IMAGE_BROWSER_PORT

        def _already_serving():
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{port}/")
                with urllib.request.urlopen(req, timeout=2) as resp:
                    return resp.status == 200
            except Exception:
                return False

        launched = False
        if not _already_serving():
            env = dict(os.environ)
            env["FLASK_APP_PORT"] = str(port)
            env["FLASK_APP_HOST"] = "0.0.0.0"
            env["UNIFIED_LAUNCHER"] = "1"  # never open a browser on the server
            subprocess.Popen(
                ["/bin/bash", f"{image_browser_dir}/run.sh"],
                cwd=image_browser_dir,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            launched = True

        # Return a URL the current client can reach (works from iPad via Tailscale/LAN).
        # Use the host the client is already connected through, not a hardcoded IP.
        host = request.headers.get("host", "127.0.0.1")
        if ":" in host:  # strip any port from the Host header
            host = host.rsplit(":", 1)[0]
        message = "Launched Image Browser" if launched else "Image Browser ready"
        return {"status": "ok", "message": message, "url": f"http://{host}:{port}/"}
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": str(e)}, status_code=500
        )


@app.post("/api/generate")
async def handle_generate(req: GenerateRequest):
    positive_prompt = req.positive_prompt.strip()
    if not positive_prompt:
        return JSONResponse(
            {"status": "error", "message": "Positive prompt is required."},
            status_code=400,
        )

    generation_mode = req.generation_mode
    print(f"[GENERATE] mode={generation_mode} prompt={positive_prompt[:60]}...")
    input_image_filename = req.input_image_filename

    if generation_mode == "I2I" and not input_image_filename:
        return JSONResponse(
            {"status": "error", "message": "I2I mode requires an input image."},
            status_code=400,
        )

    dimension_mode = req.dimension_mode
    mp = req.mp
    ar_str = req.ar

    if dimension_mode == "MP + AR":
        ar = shared.parse_aspect_ratio(ar_str)
        width, height = shared.calc_dimensions(mp, ar)
    else:
        width = req.width
        height = req.height

    seed = req.seed
    denoise = req.denoise
    steps = req.steps
    cfg = req.cfg
    scheduler = req.scheduler
    sampler = req.sampler
    lora1_name = req.lora1_name
    lora1_strength = req.lora1_strength
    lora2_name = req.lora2_name
    lora2_strength = req.lora2_strength
    unet_name = req.unet_name
    clip_name = req.clip_name
    clip_type = req.clip_type
    vae_name = req.vae_name

    # The model's own defaults: MOSS-Image carries a recommended negative prompt and, when
    # config.json names one, a skip-layer-guidance block. Both come from the same preset the UI
    # applies, so the graph and the panel can never disagree.
    model_preset = shared.get_preset(unet_name) or {}
    negative_prompt = str(model_preset.get("negative") or "")
    slg = model_preset.get("slg")

    # MOSS-Image is a text-to-image DiT: no image input, no VAEEncode, no reference slots. Refuse
    # in words rather than sampling an edit that cannot see the picture.
    if shared.is_text_only_clip(clip_type) and generation_mode == "I2I":
        return JSONResponse(
            {"status": "error",
             "message": f"{unet_name or 'This model'} is text-to-image only — it has no image "
                        "input, so it cannot run an I2I edit. Switch Generation Mode to T2I."},
            status_code=400,
        )

    # ── Extra references (image_2 … image_N) ──────────────────────────────────────────────
    # Qwen-Image 2.1 feeds every LoadImage into the encoder's autogrow `images` input, which the
    # text encoder sees as "Picture 2", "Picture 3" … and the VAE splices in as reference latents.
    # The graph side of this has been in shared.build_workflow since the node landed; nothing
    # ever supplied the filenames, so a job could only ever carry image_1.
    reference_filenames = [f for f in (req.reference_images or []) if f][:15]
    if reference_filenames and clip_type != "qwen_image":
        return JSONResponse(
            {"status": "error",
             "message": "Reference images need the Qwen-Image 2.1 encoder (clip type 'qwen_image')."},
            status_code=400,
        )
    if reference_filenames and "2.1" not in (unet_name or "").lower():
        return JSONResponse(
            {"status": "error",
             "message": f"Reference images are a Qwen-Image 2.1 feature; '{unet_name}' has no image slots."},
            status_code=400,
        )
    if reference_filenames and (generation_mode != "I2I" or not input_image_filename):
        return JSONResponse(
            {"status": "error",
             "message": "References are image_2 upward, so they need image_1: run the edit in I2I with an input picture."},
            status_code=400,
        )
    _missing_refs = [f for f in reference_filenames
                     if not os.path.exists(os.path.join(shared.COMFY_INPUT_DIR, f))]
    if _missing_refs:
        return JSONResponse(
            {"status": "error",
             "message": "Reference image(s) not in ComfyUI's input folder: " + ", ".join(_missing_refs)},
            status_code=400,
        )

    date_str = datetime.now().strftime("%Y%m%d")
    import re as _re
    slug = _re.sub(r'[^a-zA-Z0-9\-_]', '', positive_prompt.replace(" ", "-"))[:40]
    prefix = f"{date_str}_{slug}"

    # For I2I, resize the input image server-side
    workflow_image_filename = input_image_filename
    _resized_temp_files = []  # track resized copies for cleanup
    registered = False        # True once a prompt_id owns them (only then may they be left on disk)
    if generation_mode == "I2I" and input_image_filename:
        try:
            Image = shared._pil()
            if Image is None:
                raise RuntimeError("PIL is not available")
            img_path = os.path.join(shared.COMFY_INPUT_DIR, input_image_filename)
            print(f"[RESIZE] Opening {img_path}")
            img = Image.open(img_path)
            orig_size = img.size
            print(f"[RESIZE] Original size: {orig_size}, target: {width}x{height}")
            if orig_size != (width, height):
                os.makedirs(shared.COMFY_INPUT_DIR, exist_ok=True)
                try:
                    resample = Image.LANCZOS
                except AttributeError:
                    resample = Image.BICUBIC
                resized = img.resize((width, height), resample)
                base, ext = os.path.splitext(input_image_filename)
                # Per job, not per upload: pressing Generate twice from one source (a changed MP)
                # used to write the same `<base>_resized.png` twice, so the second job's size
                # replaced the first's before it executed — and the first job to finish deleted the
                # file the other one still needed.
                job_token = datetime.now().strftime("%H%M%S_%f")
                resized_name = f"{base}_resized_{job_token}{ext}"
                resized_path = os.path.join(shared.COMFY_INPUT_DIR, resized_name)
                resized.save(resized_path, "PNG")
                workflow_image_filename = resized_name
                _resized_temp_files.append(resized_path)
                print(
                    f"[RESIZE] SUCCESS: {orig_size} -> {width}x{height} saved as {resized_name}"
                )
            else:
                print(f"[RESIZE] No resize needed, image already {width}x{height}")
        except Exception as e:
            import traceback

            print(f"[RESIZE ERROR] {e}")
            traceback.print_exc()

    try:
        api_wf = shared.build_workflow(
            positive_prompt,
            width,
            height,
            seed,
            denoise,
            steps,
            cfg,
            scheduler,
            sampler,
            lora1_name,
            lora1_strength,
            lora2_name,
            lora2_strength,
            unet_name,
            clip_name,
            clip_type,
            vae_name,
            prefix,
            generation_mode,
            workflow_image_filename,
            req.upscale,
            pag_scale=req.pag_scale,
            ref_image_filenames=reference_filenames,
            negative_prompt=negative_prompt,
            slg=slg,
        )
        graph_wf = shared.build_workflow(
            positive_prompt,
            width,
            height,
            seed,
            denoise,
            steps,
            cfg,
            scheduler,
            sampler,
            lora1_name,
            lora1_strength,
            lora2_name,
            lora2_strength,
            unet_name,
            clip_name,
            clip_type,
            vae_name,
            prefix,
            generation_mode,
            workflow_image_filename,
            req.upscale,
            fmt="graph",
            pag_scale=req.pag_scale,
            ref_image_filenames=reference_filenames,
            negative_prompt=negative_prompt,
            slg=slg,
        )

        with open(os.path.join(PROJECT_ROOT, "workflow-api.json"), "w") as f:
            json.dump({"prompt": api_wf}, f, indent=2)
        with open(os.path.join(PROJECT_ROOT, "workflow.json"), "w") as f:
            json.dump(graph_wf, f, indent=2)

        try:
            from applib.llm import comfy_guard
            comfy_guard(api_wf, shared.COMFY_HOST)   # fail here naming the node, not mid-render
        except ImportError:
            pass                                     # applib not installed in this venv
        payload = json.dumps({"prompt": api_wf}).encode("utf-8")
        req_comfy = urllib.request.Request(
            f"{shared.COMFY_HOST}/prompt",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        resp = urllib.request.urlopen(req_comfy, timeout=30)
        result = json.loads(resp.read())
        prompt_id = result.get("prompt_id")

        if not prompt_id:
            print(f"[WARN] ComfyUI /prompt response missing prompt_id: {result}")
            return JSONResponse(
                {
                    "status": "error",
                    "message": "No prompt_id received from ComfyUI.",
                },
                status_code=500,
            )

        _generation_meta[prompt_id] = {
            "start": time.time(),
            "snapshot": {
                "width": width,
                "height": height,
                "steps": steps,
                "sampler": sampler,
                "scheduler": scheduler,
                "unet_name": unet_name,
            },
        }

        print(f"[GENERATE] Submitted prompt_id={prompt_id}")

        # Hand the resized copies to the status poller: they are still needed, ComfyUI has only
        # queued the job at this point.
        if _resized_temp_files:
            _resized_inputs[prompt_id] = list(_resized_temp_files)
            registered = True
        _prune_resized()

        return {"status": "ok", "prompt_id": prompt_id}

    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[ERROR] ComfyUI /prompt returned HTTP {e.code}: {body[:500]}")
        return JSONResponse(
            {
                "status": "error",
                "message": f"ComfyUI HTTP {e.code}: {body[:500]}",
            },
            status_code=500,
        )
    except Exception as e:
        print(f"[ERROR] Generation submit failed: {e}")
        return JSONResponse(
            {"status": "error", "message": str(e)}, status_code=500
        )

    finally:
        # The cleanup is keyed by prompt_id, so a submit that never produced one leaves the resized
        # copy owned by nobody and it sits in ComfyUI's input dir for good. Drop it here instead.
        if _resized_temp_files and not registered:
            for _path in _resized_temp_files:
                try:
                    os.remove(_path)
                except OSError:
                    pass
            print(f"[CLEANUP] dropped {len(_resized_temp_files)} resized input(s) after a failed submit")


@app.post("/api/calc_dimensions")
async def handle_calc_dimensions(req: CalcDimensionsRequest):
    ar = shared.parse_aspect_ratio(req.ar)
    width, height = shared.calc_dimensions(req.mp, ar)
    return {
        "status": "ok",
        "width": width,
        "height": height,
        "display": f"Calculated: {width} x {height}",
    }


@app.post("/api/upload_image")
async def handle_upload_image(file: UploadFile = File(...)):
    try:
        Image = shared._pil()
        if Image is None:
            raise RuntimeError("PIL is not available")
        img = Image.open(file.file)
        filename = shared.save_input_image(img)
        return {"status": "ok", "filename": filename}
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": str(e)}, status_code=500
        )


@app.post("/api/upload_reference")
async def handle_upload_reference(file: UploadFile = File(...), slot: int = 2):
    """Save one extra reference (image_2 … image_N) into ComfyUI's input folder.

    A reference is *not* the canvas: the encoder resizes each one to its own size (resolution 0),
    so a 4 MP reference costs vision tokens and VAE latents without improving anything. Cap every
    reference at ~1 MP here, where the pixels are still cheap to touch.
    """
    try:
        Image = shared._pil()
        if Image is None:
            raise RuntimeError("PIL is not available")
        img = Image.open(file.file)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        w, h = img.size
        if w * h > 1_000_000:
            import math as _math
            try:
                resample = Image.LANCZOS
            except AttributeError:
                resample = Image.BICUBIC
            scale = _math.sqrt(1_000_000 / float(w * h))
            img = img.resize((max(32, int(w * scale)), max(32, int(h * scale))), resample)
        shared._ensure_dirs()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"ref_img{int(slot)}_{timestamp}.png"
        img.save(os.path.join(shared.COMFY_INPUT_DIR, filename), "PNG")
        # Housekeeping: references are per-run scratch, unlike the i2i source.
        cutoff = time.time() - 24 * 3600
        for name in os.listdir(shared.COMFY_INPUT_DIR):
            if not name.startswith("ref_img"):
                continue
            path = os.path.join(shared.COMFY_INPUT_DIR, name)
            try:
                if os.path.getmtime(path) < cutoff:
                    os.remove(path)
            except OSError:
                pass
        return {"status": "ok", "filename": filename, "slot": int(slot), "width": img.size[0],
                "height": img.size[1]}
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": str(e)}, status_code=500
        )


@app.post("/api/ui_state")
async def handle_post_ui_state(req: UiStateRequest):
    """Persist the last-selected model so a reload returns to it."""
    return {"status": "ok", "ui_state": _save_ui_state({
        "last_unet": req.last_unet,
        "generation_mode": req.generation_mode,
    })}


@app.post("/api/save_settings")
async def handle_save_settings(req: SaveSettingsRequest):
    if req.unet_name:
        mode = req.generation_mode if req.generation_mode in ("t2i", "i2i") else "t2i"
        save_model_user_settings(
            req.unet_name,
            req.lora1_name,
            req.lora1_strength,
            req.lora2_name,
            req.lora2_strength,
            mode,
        )
    return {"status": "ok"}


@app.post("/api/defaults")
async def handle_defaults(req: DefaultsRequest):
    action = req.action
    if action == "load":
        if req.unet_name:
            defaults = get_model_defaults(req.unet_name, req.mode)
            loras = shared.get_loras_for_model(req.unet_name)
            return {"status": "ok", "defaults": defaults, "loras": loras}
        else:
            chain = get_chain_defaults(req.direction)
            loras_stage1 = shared.get_loras_for_model(chain["stage1"]["unet_name"])
            loras_stage2 = shared.get_loras_for_model(chain["stage2"]["unet_name"])
            return {"status": "ok", "chain": chain, "loras_stage1": loras_stage1, "loras_stage2": loras_stage2}
    elif action == "save":
        if req.unet_name:
            # Merge rather than replace, so a caller may post the few fields it
            # owns (the Prompt tab auto-save sends only generation params) without
            # wiping keys it does not know about (clip/vae written by the Defaults
            # tab). get_model_defaults already folds in the shipped preset, so the
            # stored entry stays a complete record either way.
            merged = {**get_model_defaults(req.unet_name, req.mode), **req.defaults}
            merged = {k: v for k, v in merged.items() if k in PERSISTED_DEFAULT_KEYS}
            save_model_defaults(req.unet_name, req.mode, merged)
            return {
                "status": "ok",
                "defaults": merged,
                "message": f"Saved {req.mode} defaults for {req.unet_name}",
            }
        else:
            save_chain_defaults(
                req.direction,
                req.chain.get("stage1", {}),
                req.chain.get("stage2", {}),
            )
            return {
                "status": "ok",
                "message": f"Saved {req.direction} chain defaults",
            }
    elif action == "reset":
        if req.unet_name:
            settings = _load_user_settings()
            if req.unet_name in settings.get("model_settings", {}):
                if req.mode in settings["model_settings"][req.unet_name]:
                    del settings["model_settings"][req.unet_name][req.mode]
                if not settings["model_settings"][req.unet_name]:
                    del settings["model_settings"][req.unet_name]
            _save_user_settings(settings)
            preset = shared.get_preset(req.unet_name)
            base = {**preset, "denoise": 1.0 if req.mode == "t2i" else 0.8}
            return {"status": "ok", "defaults": base}
        else:
            direction = req.direction
            settings = _load_user_settings()
            if "chain" in settings.get("model_settings", {}):
                if direction in settings["model_settings"]["chain"]:
                    del settings["model_settings"]["chain"][direction]
                if not settings["model_settings"]["chain"]:
                    del settings["model_settings"]["chain"]
            _save_user_settings(settings)
            return {"status": "ok", "chain": get_chain_defaults(direction)}
    else:
        return JSONResponse(
            {"status": "error", "message": f"Unknown action: {action}"},
            status_code=400,
        )


@app.get("/api/system_settings")
async def handle_get_system_settings():
    return {
        "status": "ok",
        "system_settings": {
            "comfy_root": shared.COMFY_ROOT,
            "comfy_python": shared.COMFY_PYTHON,
            "output_dir": shared.OUTPUT_DIR,
            "loras_root": shared.LORAS_ROOT,
            "comfy_host": shared.COMFY_HOST,
        },
    }


@app.post("/api/system_settings")
async def handle_post_system_settings(req: SystemSettingsRequest):
    new_paths = {}
    if req.comfy_root:
        p = os.path.expanduser(req.comfy_root)
        if not os.path.isdir(p):
            return JSONResponse(
                {"status": "error", "message": f"ComfyUI root does not exist: {p}"},
                status_code=400,
            )
        new_paths["comfy_root"] = p
    if req.comfy_python:
        p = os.path.expanduser(req.comfy_python)
        if not os.path.isfile(p):
            return JSONResponse(
                {"status": "error", "message": f"Python executable does not exist: {p}"},
                status_code=400,
            )
        new_paths["comfy_python"] = p
    if req.output_dir:
        new_paths["output_dir"] = os.path.expanduser(req.output_dir)
    if req.loras_root:
        new_paths["loras_root"] = os.path.expanduser(req.loras_root)
    if req.comfy_host:
        new_paths["comfy_host"] = req.comfy_host

    try:
        shared.reload_paths(new_paths)
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": f"Failed to apply paths: {e}"},
            status_code=500,
        )

    _save_system_settings({
        "comfy_root": shared.COMFY_ROOT,
        "comfy_python": shared.COMFY_PYTHON,
        "output_dir": shared.OUTPUT_DIR,
        "loras_root": shared.LORAS_ROOT,
        "comfy_host": shared.COMFY_HOST,
    })
    return {"status": "ok", "message": "System settings saved"}


# ── Model registry (the Models tab) ────────────────────────────────
# This is what lets the app run on somebody else's machine: the ComfyUI folder and each
# model's own text encoder / VAE live here, not in the shipped config.

KNOWN_ENCODER_TYPES = [
    "qwen_image", "lumina2", "flux2", "flux", "krea2", "moss_image", "sd3", "sdxl", "wan", "stable_diffusion",
]


class RegistryRequest(BaseModel):
    paths: Dict[str, str] = Field(default_factory=dict)
    model_dirs: Dict[str, List[str]] = Field(default_factory=dict)
    models: List[Dict[str, Any]] = Field(default_factory=list)


def _registry_payload(warnings=None):
    """Everything the Models tab draws itself from, in one response."""
    return {
        "status": "ok",
        "paths": {
            "comfy_root": shared.COMFY_ROOT,
            "comfy_python": shared.COMFY_PYTHON,
            "output_dir": shared.OUTPUT_DIR,
            "loras_root": shared.LORAS_ROOT,
            "comfy_host": shared.COMFY_HOST,
        },
        "model_dirs": shared.MODEL_DIRS,
        "dirs_resolved": {kind: shared.model_dirs_for(kind) for kind in shared.MODEL_KINDS},
        "models": shared.registry_info(),
        "scanned": {kind: shared.scan_model_files(kind) for kind in shared.MODEL_KINDS},
        "encoder_types": sorted(set(KNOWN_ENCODER_TYPES) | set(shared.CLIP_TYPES)),
        "samplers": shared.SAMPLERS,
        "schedulers": shared.SCHEDULERS,
        "comfy_running": shared.is_comfyui_running(),
        "warnings": warnings or [],
    }


@app.get("/api/registry")
async def handle_get_registry():
    return _registry_payload()


@app.post("/api/registry")
async def handle_post_registry(req: RegistryRequest):
    warnings = []
    if req.paths.get("comfy_root"):
        root = os.path.expanduser(req.paths["comfy_root"])
        if not os.path.isdir(root):
            return JSONResponse(
                {"status": "error", "message": f"ComfyUI folder does not exist: {root}"},
                status_code=400,
            )
        req.paths["comfy_root"] = root
    if req.paths.get("comfy_python"):
        py = os.path.expanduser(req.paths["comfy_python"])
        if not os.path.isfile(py):
            warnings.append(f"python executable not found: {py}")
        req.paths["comfy_python"] = py

    names = set()
    for entry in req.models:
        unet = (entry.get("unet") or "").strip()
        if not unet:
            warnings.append(f"a model entry has no model file and was dropped ({entry.get('name') or 'unnamed'})")
        label = (entry.get("name") or unet).strip()
        if label in names:
            warnings.append(f"duplicate model name '{label}' — the later one wins")
        names.add(label)
        if unet and not shared.registry_file_exists("unet", unet):
            warnings.append(f"'{unet}' is not in the ComfyUI folder — it will fail to load until it is")
        if entry.get("text_encoder") and not shared.registry_file_exists("text_encoder", entry["text_encoder"]):
            warnings.append(f"text encoder '{entry['text_encoder']}' not found")
        if entry.get("vae") and not shared.registry_file_exists("vae", entry["vae"]):
            warnings.append(f"VAE '{entry['vae']}' not found")

    try:
        shared.save_registry(req.models, req.model_dirs or None, req.paths or None)
    except Exception as e:
        return JSONResponse({"status": "error", "message": f"Could not write config.json: {e}"}, status_code=500)

    # Keep user_settings mirror in step so the Paths fields survive a settings-only reload.
    _save_system_settings({
        "comfy_root": shared.COMFY_ROOT,
        "comfy_python": shared.COMFY_PYTHON,
        "output_dir": shared.OUTPUT_DIR,
        "loras_root": shared.LORAS_ROOT,
        "comfy_host": shared.COMFY_HOST,
    })
    payload = _registry_payload(warnings)
    payload["message"] = f"Saved {len(shared.MODELS)} model(s)"
    return payload


@app.post("/api/detect_comfy")
async def handle_detect_comfy():
    """Look where a ComfyUI install usually is, so a new user does not have to type a path."""
    home = os.path.expanduser("~")
    candidates = [
        os.environ.get("COMFYUI_ROOT", ""),
        os.path.join(home, "comfy", "ComfyUI"),
        os.path.join(home, "ComfyUI"),
        os.path.join(home, "comfyui"),
        os.path.join(home, "ComfyUI_windows_portable", "ComfyUI"),
        os.path.join(home, ".local", "share", "ComfyUI"),
        os.path.join(home, "Documents", "ComfyUI"),
        "/opt/ComfyUI",
        "/usr/local/ComfyUI",
        "/usr/share/ComfyUI",
    ]
    found = []
    for path in candidates:
        if not path:
            continue
        path = os.path.abspath(os.path.expanduser(path))
        if not os.path.isdir(path) or path in [f["path"] for f in found]:
            continue
        models_dir = os.path.join(path, "models")
        found.append({
            "path": path,
            "has_models": os.path.isdir(models_dir),
            "has_main": os.path.isfile(os.path.join(path, "main.py")),
            "models": {
                kind: sum(1 for _ in shared._walk_model_files(base))
                for kind, base in (
                    ("unet", os.path.join(path, "models", "diffusion_models")),
                    ("text_encoder", os.path.join(path, "models", "text_encoders")),
                    ("vae", os.path.join(path, "models", "vae")),
                )
            },
            "python": next((p for p in (
                os.path.join(path, "venv", "bin", "python"),
                os.path.join(path, "python_embeded", "python.exe"),
                sys.executable,
            ) if os.path.isfile(p)), ""),
        })
    return {"status": "ok", "candidates": found}


@app.post("/api/process_image")
async def handle_process_image(req: ProcessImageRequest):
    if not req.filename:
        return JSONResponse(
            {"status": "error", "message": "No filename provided"},
            status_code=400,
        )

    # Find the file — try the date subfolder first (ComfyUI saves as YYYYMMDD/...)
    src_path = None
    date_prefix = req.filename[:8] if len(req.filename) >= 8 and req.filename[:8].isdigit() else None
    if date_prefix:
        candidate = os.path.join(shared.OUTPUT_DIR, date_prefix, req.filename)
        if os.path.isfile(candidate):
            src_path = candidate
    if not src_path:
        # Fall back to full walk (for files without date prefix or in root)
        for root, dirs, files in os.walk(shared.OUTPUT_DIR):
            if req.filename in files:
                src_path = os.path.join(root, req.filename)
                break
    if not src_path or not os.path.isfile(src_path):
        return JSONResponse(
            {"status": "error", "message": f"File not found: {req.filename}"},
            status_code=404,
        )

    try:
        Image = shared._pil()
        if Image is None:
            raise RuntimeError("PIL is not available")

        with Image.open(src_path) as img:
            # Convert to RGB/RGBA for processing
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")
            result = img.copy()

        # Levels
        result = shared.apply_levels(
            result,
            req.shadows,
            req.highlights,
            req.output_min,
            req.output_max,
        )

        # Contrast + Saturation
        result = shared.apply_contrast_saturation(
            result,
            req.contrast,
            req.saturation,
        )

        # White balance (temperature only — brightness handled separately)
        result = shared.apply_white_balance(
            result,
            req.temperature,
            0,  # tint is no longer used from UI, keep at 0
        )

        # Brilliance (multiplicative brightness)
        result = shared.apply_brilliance(
            result,
            req.brilliance,
        )

        # Vignette
        result = shared.apply_vignette(
            result,
            req.vignette_exposure,
            req.vignette_hardness,
            req.vignette_scale,
            req.vignette_shape,
        )

        # Determine output filename
        base, ext = os.path.splitext(req.filename)
        if req.save_mode == "overwrite":
            # Force .png extension since we always save as PNG
            out_filename = base + ".png" if ext.lower() != ".png" else req.filename
            out_path = src_path if ext.lower() == ".png" else os.path.join(os.path.dirname(src_path), out_filename)
        else:
            # Generate _v2, _v3, etc.
            import re
            # Strip existing _vN suffix
            m = re.search(r"_v(\d+)$", base)
            if m:
                version = int(m.group(1))
                clean_base = base[: m.start()]
            else:
                version = 1
                clean_base = base
            new_version = version + 1
            out_filename = f"{clean_base}_v{new_version}{ext}"
            # Save in the same subfolder as the original image
            src_dir = os.path.dirname(src_path)
            out_path = os.path.join(src_dir, out_filename)
            # Ensure uniqueness
            counter = new_version
            while os.path.isfile(out_path):
                counter += 1
                out_filename = f"{clean_base}_v{counter}{ext}"
                out_path = os.path.join(src_dir, out_filename)

        result.save(out_path, "PNG")

        return {
            "status": "ok",
            "filename": out_filename,
            "message": f"Saved as {out_filename}",
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(
            {"status": "error", "message": str(e)},
            status_code=500,
        )


# ── System stats helpers ───────────────────────────────────────
_prev_cpu_jiffies = None


def _read_cpu_percent():
    global _prev_cpu_jiffies
    try:
        with open("/proc/stat", "r") as f:
            line = f.readline()
        parts = line.split()
        if parts[0] != "cpu":
            return 0.0
        user, nice, system, idle, iowait, irq, softirq, steal = map(float, parts[1:9])
        total = user + nice + system + idle + iowait + irq + softirq + steal
        used = total - idle - iowait
        if _prev_cpu_jiffies is not None:
            prev_used, prev_total = _prev_cpu_jiffies
            delta_used = used - prev_used
            delta_total = total - prev_total
            pct = (delta_used / delta_total) * 100 if delta_total > 0 else 0.0
        else:
            pct = 0.0
        _prev_cpu_jiffies = (used, total)
        return round(pct, 1)
    except Exception:
        return 0.0


def _read_ram_percent():
    try:
        total = free = 0
        with open("/proc/meminfo", "r") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    total = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable:"):
                    free = int(line.split()[1]) * 1024
        if total > 0:
            used = total - free
            return round((used / total) * 100, 1), total, used
        return 0.0, 0, 0
    except Exception:
        return 0.0, 0, 0


def _read_gpu_stats():
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            util, mem_used, mem_total = result.stdout.strip().split(", ")
            util = float(util)
            mem_used = float(mem_used)
            mem_total = float(mem_total)
            mem_pct = round((mem_used / mem_total) * 100, 1) if mem_total > 0 else 0.0
            return util, mem_pct, mem_used, mem_total
    except Exception:
        pass
    return 0.0, 0.0, 0.0, 0.0


@app.get("/api/stats")
async def handle_stats():
    cpu_pct = _read_cpu_percent()
    ram_pct, ram_total, ram_used = _read_ram_percent()
    gpu_util, gpu_mem_pct, gpu_mem_used, gpu_mem_total = _read_gpu_stats()
    return {
        "status": "ok",
        "cpu": cpu_pct,
        "ram": ram_pct,
        "ram_total_gb": round(ram_total / (1024 ** 3), 2),
        "ram_used_gb": round(ram_used / (1024 ** 3), 2),
        "gpu": gpu_util,
        "gpu_mem": gpu_mem_pct,
        "gpu_mem_used_gb": round(gpu_mem_used / 1024, 2),
        "gpu_mem_total_gb": round(gpu_mem_total / 1024, 2),
    }


# ── No-cache index.html ──────────────────────────────────────────
from starlette.responses import FileResponse

@app.get("/")
async def serve_index():
    return FileResponse(
        str(PROJECT_ROOT / "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )

@app.get("/index.html")
async def serve_index_html():
    return FileResponse(
        str(PROJECT_ROOT / "index.html"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )

# ── Static files ─────────────────────────────────────────────────

class NoCacheStaticFiles(StaticFiles):
    """StaticFiles that sends no-cache headers for JS/CSS to prevent stale browser cache."""
    async def get_response(self, path: str, scope):
        resp = await super().get_response(path, scope)
        if path.endswith((".js", ".css")):
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp

app.mount("/", NoCacheStaticFiles(directory=PROJECT_ROOT, html=True), name="static")


# ── Port finder ──────────────────────────────────────────────────
def find_free_port(start=7864):
    import socket

    port = start
    while True:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            port += 1


# ── Main entry ─────────────────────────────────────────────────
def main():
    env_port = os.environ.get("PORT")
    port = int(env_port) if env_port else find_free_port()
    print(f"=== Qwen-Image 2.1 Studio v{VERSION} ===")
    print(f"URL: http://127.0.0.1:{port}")
    # Resized I2I inputs are keyed by prompt_id in this process's memory, so anything registered
    # before the last restart is unreachable: sweep the old ones once, at startup.
    _sweep_resized_files(force=True)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
