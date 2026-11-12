"""Shared utilities for ComfyUI Ernie Generator."""

# ── Named constants ──────────────────────────────────
DIM_PIXEL_ROUNDING = 64
DEFAULT_MP = 1.54
DEFAULT_STEPS = 8
DEFAULT_CFG = 1.0
DEFAULT_SAMPLER = "euler"
DEFAULT_SCHEDULER = "simple"
COMFYUI_PORT = 8188
COMFYUI_TIMEOUT = 30  # seconds for HTTP requests to ComfyUI
COMFYUI_LAUNCH_RETRIES = 60  # 60 * 2s = 120s startup timeout



import json
import os
import signal
import subprocess
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import numpy as np


# ── Lazy PIL import (try once at module load) ──────────────────
_PIL_MODULE = None
_PIL_ENHANCE_MODULE = None

try:
    from PIL import Image as _PIL_Image
    _PIL_MODULE = _PIL_Image
except ImportError:
    _PIL_MODULE = None

try:
    from PIL import ImageEnhance as _PIL_Enhance
    _PIL_ENHANCE_MODULE = _PIL_Enhance
except ImportError:
    _PIL_ENHANCE_MODULE = None


def _pil():
    return _PIL_MODULE


def _pil_image_enhance():
    return _PIL_ENHANCE_MODULE


# ── Load config ──────────────────────────────────────────────────
_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
_CONFIG_PATH = os.path.join(_PROJECT_ROOT, "config.json")
_CONFIG_EXAMPLE = os.path.join(_PROJECT_ROOT, "config.example.json")

# A clone of this repo has no config.json — it is the file holding this machine's paths and
# model registry, so it is git-ignored. First run starts from the shipped example instead of
# crashing on a missing file (the old code did `open(_CONFIG_PATH)` unconditionally).
if not os.path.exists(_CONFIG_PATH) and os.path.exists(_CONFIG_EXAMPLE):
    import shutil as _shutil
    _shutil.copyfile(_CONFIG_EXAMPLE, _CONFIG_PATH)
    print(f"[CONFIG] created {_CONFIG_PATH} from config.example.json — set your ComfyUI folder in the Models tab")

with open(_CONFIG_PATH, "r") as _f:
    _CFG = json.load(_f)

VERSION = _CFG["version"]
COMFY_HOST = _CFG["comfy_host"]
COMFY_ROOT = os.path.expanduser(_CFG["comfy_root"])
COMFY_PYTHON = os.path.expanduser(_CFG["comfy_python"])
OUTPUT_DIR = os.path.expanduser(_CFG["output_dir"])
COMFY_INPUT_DIR = os.path.join(COMFY_ROOT, "input")
LORAS_ROOT = os.path.expanduser(_CFG["loras_root"])

SAMPLERS = _CFG["samplers"]
SCHEDULERS = _CFG["schedulers"]
UNET_MODELS = _CFG["unet_models"]
# First entry of the configured list is this app's purpose-built model; the
# UI's active sub-tab and every "no model supplied" fallback resolve to it.
# A fresh clone has an empty registry (models are added in the Models tab), so
# this must tolerate an empty list rather than crash at import.
DEFAULT_UNET = UNET_MODELS[0] if UNET_MODELS else ""
CLIP_MODELS = _CFG["clip_models"]
CLIP_TYPES = _CFG["clip_types"]
VAE_MODELS = _CFG["vae_models"]

# ── Qwen-Image 2.1 diffusion model discovery ─────────────────────
# config.json's unet_models is a frozen list, which is what left the
# .safetensors diffusion models (qwen_image_2.1_int8_convrot) invisible to this
# app while the sibling Qwen-Edit Studio listed them: only the two GGUF quants
# were ever in it, and the app has no model manager of its own.
# The list is therefore merged with a disk scan of every root this ComfyUI
# loads unets from — its own store plus the shared store it reads through
# extra_model_paths.yaml — so a newly downloaded quant appears on "Refresh
# Model List" without hand-editing JSON.
def _unet_scan_roots():
    """Unet dirs of this ComfyUI, own store first (highest dedupe priority)."""
    roots = model_dirs_for("unet")
    shared_root = SYSTEM_PATHS.get("shared_comfy_root")
    if shared_root and os.path.abspath(shared_root) != os.path.abspath(COMFY_ROOT):
        roots.append(os.path.join(shared_root, "models", "unet"))
        roots.append(os.path.join(shared_root, "models", "diffusion_models"))
    return roots


# Separator-insensitive marker: the GGUF quants are named qwen-image-2.1-*.gguf
# while the safetensors builds are qwen_image_2.1_*.safetensors, so a literal
# match would silently hide one of the two families.
_QWEN21_UNET_MARKER = "qwenimage21"
# VAE and text-encoder files live in the same model dirs and carry the same
# 2.1 marker; picking one as a unet would only fail at model-detection time.
UNET_SKIP_MARKERS = ("vae", "text_encoder", "textencoder", "clip_")


def _norm_model_name(name):
    """Normalize separators so qwen-image-2.1 and qwen_image_2.1 both match."""
    return (name or "").lower().replace("-", "").replace("_", "").replace(".", "")


def is_diffusion_model_file(name):
    """True for a file that a unet loader node can actually take."""
    low = (name or "").lower()
    if not low.endswith((".gguf", ".safetensors")):
        return False
    if any(marker in low for marker in UNET_SKIP_MARKERS):
        return False
    norm = _norm_model_name(name)
    # The text encoder/VAE of the 2.1 stack are also named *qwen*2.1*; the
    # transformer build shares the family marker and is a real diffusion model,
    # so only the subdirectories below are trusted to filter, not the name.
    if _QWEN21_UNET_MARKER in norm:
        return True
    # Other families (ERNIE / Z-Image / Krea) are listed only when the config names them: each
    # needs a matching preset for its text encoder, VAE, steps and CFG, and a stray file from one
    # of those families would load happily and then sample with the wrong pairing.
    return norm in {_norm_model_name(n) for n in UNET_MODELS}


def scan_qwen21_unets():
    """Qwen-Image 2.1 diffusion models on disk: [{name, kind, loader, size_gb, root}]."""
    found, seen = [], set()
    for root in _unet_scan_roots():
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            if not is_diffusion_model_file(name):
                continue
            path = os.path.join(root, name)
            if not os.path.isfile(path) or name in seen:
                continue
            seen.add(name)
            is_gguf = name.lower().endswith(".gguf")
            found.append({
                "name": name,
                "kind": "gguf" if is_gguf else "safetensors",
                "loader": "UnetLoaderGGUF" if is_gguf else "UNETLoader",
                "size_gb": round(os.path.getsize(path) / 1e9, 2),
                "root": root,
            })
    found.sort(key=lambda m: m["size_gb"])
    return found


def get_unet_model_info():
    """Every selectable unet: the configured list plus anything found on disk.

    Order matters — configured entries keep their positions (UNET_MODELS[0] is
    DEFAULT_UNET), then the scanned-only extras follow.
    """
    info, seen = [], set()
    scanned = {m["name"]: m for m in scan_qwen21_unets()}
    for name in UNET_MODELS:
        if name in seen:
            continue
        seen.add(name)
        meta = scanned.get(name)
        if meta:
            info.append(dict(meta))
        else:
            is_gguf = is_gguf_model(name)
            info.append({
                "name": name,
                "kind": "gguf" if is_gguf else "safetensors",
                "loader": "UnetLoaderGGUF" if is_gguf else "UNETLoader",
                "size_gb": None,
                "root": None,
            })
    for meta in scanned.values():
        if meta["name"] not in seen:
            seen.add(meta["name"])
            info.append(dict(meta))
    return info


def get_unet_models():
    """Names only, for callers that want a flat list."""
    return [m["name"] for m in get_unet_model_info()]


# ── Model registry ───────────────────────────────────────────────
# A model is not one file: a diffusion model only generates once it is paired with the text
# encoder it was trained against and that family's VAE. This registry is where a user says
# which is which, so nothing here is hardcoded to one machine's file names any more.
#
# config.json:
#   model_dirs  {unet|text_encoder|vae: [dirs]}   dirs relative to comfy_root unless absolute
#   models      [{name, unet, loader, text_encoder, encoder_type, vae,
#                 steps, cfg, sampler, scheduler, mp, ar, lora1_name, ...}]
#
# `presets` (the old per-family records) is still written from the registry so the generate
# path and any older config keep working unchanged.
DEFAULT_MODEL_DIRS = {
    "unet": ["models/diffusion_models", "models/unet", "models-qwen21"],
    "text_encoder": ["models/text_encoders", "models/clip"],
    "vae": ["models/vae"],
}
MODEL_KINDS = ("unet", "text_encoder", "vae")
_MODEL_EXT = (".safetensors", ".gguf", ".sft", ".pt", ".pth", ".ckpt", ".bin")


def _load_registry_cfg():
    dirs = {k: list(v) for k, v in DEFAULT_MODEL_DIRS.items()}
    for kind, dirs_list in (_CFG.get("model_dirs") or {}).items():
        if kind in dirs and isinstance(dirs_list, list):
            dirs[kind] = [str(d) for d in dirs_list]
    models = []
    for entry in (_CFG.get("models") or []):
        if isinstance(entry, dict) and entry.get("unet"):
            models.append(dict(entry))
    return dirs, models


MODEL_DIRS, MODELS = _load_registry_cfg()


def model_dirs_for(kind, comfy_root=None):
    """Absolute search dirs for a model kind, resolving relative entries against comfy_root."""
    root = comfy_root or COMFY_ROOT
    out = []
    for entry in MODEL_DIRS.get(kind, []):
        p = os.path.expanduser(str(entry))
        if not os.path.isabs(p):
            p = os.path.join(root, p)
        p = os.path.normpath(p)
        if p not in out:
            out.append(p)
    return out


def _walk_model_files(base, depth=2):
    """Files under base, up to `depth` levels down — ComfyUI allows models/<subdir>/x.safetensors."""
    if not os.path.isdir(base):
        return
    base = os.path.abspath(base)
    for cur, dirs, files in os.walk(base):
        rel_dir = os.path.relpath(cur, base)
        level = 0 if rel_dir == "." else rel_dir.count(os.sep) + 1
        if level >= depth:
            dirs[:] = []
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for name in sorted(files):
            if name.lower().endswith(_MODEL_EXT):
                yield os.path.join(rel_dir, name) if rel_dir != "." else name, os.path.join(cur, name)


def scan_model_files(kind):
    """Every file that could fill this slot, as [{name, path, dir, size_gb}] (name = ComfyUI path)."""
    found, seen = [], set()
    for base in model_dirs_for(kind):
        for name, path in _walk_model_files(base):
            name = name.replace(os.sep, "/")
            if name in seen:
                continue
            seen.add(name)
            try:
                size = round(os.path.getsize(path) / 1e9, 2)
            except OSError:
                continue
            found.append({"name": name, "path": path, "dir": os.path.dirname(path), "size_gb": size})
    found.sort(key=lambda m: m["name"].lower())
    return found


def _guess_encoder_type(unet_name):
    """Encoder type from the model file name — the only hint a file gives before it is loaded."""
    n = (unet_name or "").lower().replace("-", "_")
    if "qwen_image_2.1" in n or "qwenimage21" in n.replace("_", ""):
        return "qwen_image"
    if "moss" in n:
        return "moss_image"
    if "krea" in n:
        return "krea2"
    if "z_anime" in n or "z_image" in n or "zanime" in n:
        return "lumina2"
    if "ernie" in n or "flux2" in n:
        return "flux2"
    if "qwen" in n:
        return "qwen_image"
    return ""


def registry_entry_preset(entry):
    """A registry entry as the preset dict the generate path already understands."""
    unet = entry.get("unet") or ""
    loader = entry.get("loader") or ("UnetLoaderGGUF" if unet.lower().endswith(".gguf") else "UNETLoader")
    return {
        "unet_name": unet,
        "unet_loader": loader,
        "clip_name": entry.get("text_encoder", ""),
        "clip_type": entry.get("encoder_type", ""),
        "vae_name": entry.get("vae", ""),
        "steps": int(entry.get("steps", DEFAULT_STEPS) or DEFAULT_STEPS),
        "cfg": float(entry.get("cfg", DEFAULT_CFG) if entry.get("cfg") is not None else DEFAULT_CFG),
        "sampler": entry.get("sampler") or DEFAULT_SAMPLER,
        "scheduler": entry.get("scheduler") or DEFAULT_SCHEDULER,
        "mp": entry.get("mp"),
        "ar": entry.get("ar"),
        "width": entry.get("width"),
        "height": entry.get("height"),
        "lora1_name": entry.get("lora1_name") or "none",
        "lora1_strength": entry.get("lora1_strength", 0.0) or 0.0,
        "lora2_name": entry.get("lora2_name") or "none",
        "lora2_strength": entry.get("lora2_strength", 0.0) or 0.0,
        "registry_name": entry.get("name") or unet,
    }


def registry_file_exists(kind, name):
    """True when a file the registry names is present in that slot on disk."""
    if not name:
        return False
    base = os.path.basename(str(name).replace("\\", "/"))
    for f in _scan_cached(kind):
        if f["name"] == name or os.path.basename(f["name"]) == base:
            return True
    return False


_SCAN_CACHE = {}


def _scan_cached(kind, ttl=5.0):
    """scan_model_files with a short TTL — the UI asks 'is it there?' for every field of every
    model in one request, and each scan walks the tree."""
    key = (kind, tuple(model_dirs_for(kind)))
    hit = _SCAN_CACHE.get(key)
    if hit and (time.time() - hit[0]) < ttl:
        return hit[1]
    files = scan_model_files(kind)
    _SCAN_CACHE[key] = (time.time(), files)
    return files


def registry_lookup(unet_name):
    """The registry entry for a model file, matched on the file name ComfyUI will be given."""
    if not unet_name:
        return None
    for entry in MODELS:
        if entry.get("unet") == unet_name:
            return entry
    # A registry entry may hold a subfolder path while the caller has only the bare name, and
    # vice versa — compare on the tail so both spellings find the same record.
    base = os.path.basename(unet_name.replace("\\", "/"))
    for entry in MODELS:
        if os.path.basename((entry.get("unet") or "").replace("\\", "/")) == base:
            return entry
    return None


def registry_info():
    """The registry as the UI needs it: every entry plus whether its files are actually there."""
    scanned = {kind: {f["name"]: f for f in _scan_cached(kind)} for kind in MODEL_KINDS}
    out = []
    for entry in MODELS:
        item = dict(entry)
        unet = entry.get("unet") or ""
        item["loader"] = entry.get("loader") or (
            "UnetLoaderGGUF" if unet.lower().endswith(".gguf") else "UNETLoader"
        )
        item["exists"] = os.path.basename(unet) in {os.path.basename(k) for k in scanned["unet"]}
        item["encoder_exists"] = entry.get("text_encoder") in scanned["text_encoder"]
        item["vae_exists"] = entry.get("vae") in scanned["vae"]
        if not item.get("encoder_type"):
            item["encoder_type"] = _guess_encoder_type(unet)
        out.append(item)
    return out


def save_registry(models, model_dirs=None, paths=None):
    """Persist the registry (and optionally the model dirs / system paths) to config.json.

    Writes the derived lists and presets too, so the rest of the app — which still asks for
    unet_models/clip_models/vae_models and PRESETS[key] — needs no changes to see them.
    """
    global MODEL_DIRS, MODELS, PRESETS, UNET_MODELS, CLIP_MODELS, VAE_MODELS, CLIP_TYPES, DEFAULT_UNET
    if model_dirs is not None:
        MODEL_DIRS = {k: [str(d) for d in v] for k, v in model_dirs.items() if k in MODEL_KINDS}
        for kind in MODEL_KINDS:
            MODEL_DIRS.setdefault(kind, list(DEFAULT_MODEL_DIRS[kind]))
    if paths:
        for key, value in paths.items():
            if key in SYSTEM_PATHS and value:
                SYSTEM_PATHS[key] = os.path.expanduser(str(value))
    MODELS = [dict(m) for m in (models or []) if m.get("unet")]

    _CFG["model_dirs"] = MODEL_DIRS
    _CFG["models"] = MODELS
    _CFG["unet_models"] = [m["unet"] for m in MODELS]
    _CFG["clip_models"] = sorted({m["text_encoder"] for m in MODELS if m.get("text_encoder")})
    _CFG["vae_models"] = sorted({m["vae"] for m in MODELS if m.get("vae")})
    _CFG["clip_types"] = sorted({m["encoder_type"] for m in MODELS if m.get("encoder_type")}
                                | set(_CFG.get("clip_types") or []))
    for key in ("comfy_root", "comfy_python", "output_dir", "loras_root", "comfy_host"):
        if key in SYSTEM_PATHS:
            _CFG[key] = SYSTEM_PATHS[key]
    # One preset per registry entry, keyed by its registry name, merged over whatever presets the
    # config already carried: deleting a model from the registry must not delete the family
    # fallbacks that older configs (and the chain presets) still resolve through.
    merged_presets = dict(_CFG.get("presets") or {})
    for m in MODELS:
        merged_presets[m.get("name") or m["unet"]] = registry_entry_preset(m)
    _CFG["presets"] = merged_presets
    PRESETS = _CFG["presets"]
    UNET_MODELS = _CFG["unet_models"]
    CLIP_MODELS = _CFG["clip_models"]
    VAE_MODELS = _CFG["vae_models"]
    CLIP_TYPES = _CFG["clip_types"]
    _SCAN_CACHE.clear()
    DEFAULT_UNET = UNET_MODELS[0] if UNET_MODELS else next(
        (f["name"] for f in scan_model_files("unet")), "")

    tmp = _CONFIG_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(_CFG, f, indent=2)
        f.write("\n")
    os.replace(tmp, _CONFIG_PATH)
    reload_paths()
    return registry_info()


PRESETS = _CFG["presets"]
# Named sampling profiles (Official Baseline / High Detail). They set sampler +
# scheduler + steps + CFG together, so the same four fields move as one unit.
PROFILES = _CFG.get("profiles", {})

LORAS_ALL, LORA_FOLDERS, ROOT_LORAS = [], {}, []


# Mutable system paths — can be updated at runtime via reload_paths()
SYSTEM_PATHS = {
    "comfy_host": _CFG.get("comfy_host", "http://localhost:8189"),
    "comfy_root": os.path.expanduser(_CFG.get("comfy_root", "~/comfy/ComfyUI")),
    "comfy_python": os.path.expanduser(_CFG.get("comfy_python", "~/comfy/ComfyUI/venv/bin/python")),
    "output_dir": os.path.expanduser(_CFG.get("output_dir", "~/comfy/ComfyUI/output")),
    "loras_root": os.path.expanduser(_CFG.get("loras_root", "~/comfy/ComfyUI/models/loras")),
    # The other ComfyUI this port shares model dirs with, via the clone's
    # extra_model_paths.yaml. Scanned for unets as a second-class root; set it
    # to "" to list only the models in the clone's own store.
    "shared_comfy_root": os.path.expanduser(
        _CFG.get("shared_comfy_root", "~/comfy/ComfyUI") or ""
    ),
}


def reload_paths(overrides=None):
    """Re-compute paths from SYSTEM_PATHS (optionally merged with overrides)."""
    global COMFY_HOST, COMFY_ROOT, COMFY_PYTHON, OUTPUT_DIR, LORAS_ROOT, COMFY_INPUT_DIR
    if overrides:
        SYSTEM_PATHS.update(overrides)
    COMFY_HOST = SYSTEM_PATHS["comfy_host"]
    COMFY_ROOT = SYSTEM_PATHS["comfy_root"]
    COMFY_PYTHON = SYSTEM_PATHS["comfy_python"]
    OUTPUT_DIR = SYSTEM_PATHS["output_dir"]
    LORAS_ROOT = SYSTEM_PATHS["loras_root"]
    COMFY_INPUT_DIR = os.path.join(COMFY_ROOT, "input")
    _SCAN_CACHE.clear()
    _ensure_dirs()


def is_unet_available(unet_name):
    """True when a model is actually reachable, so a stale UI value can't be sent."""
    return unet_present(unet_name)


def _ensure_dirs():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(COMFY_INPUT_DIR, exist_ok=True)


def is_comfyui_running():
    """Check if this app's ComfyUI server is responding on port 8189."""
    try:
        req = urllib.request.Request(f"{COMFY_HOST}/system_stats", method="GET")
        req.add_header("Connection", "close")
        resp = urllib.request.urlopen(req, timeout=2)
        resp.close()
        return True
    except Exception:
        return False


def kill_port_processes(port):
    """Kill whatever process is listening on a specific TCP port."""
    try:
        result = subprocess.run(
            ["lsof", "-t", "-i", f":{port}"],
            capture_output=True, text=True, timeout=5,
        )
        for pid in result.stdout.strip().splitlines():
            if pid:
                try:
                    os.kill(int(pid), signal.SIGTERM)
                except ProcessLookupError:
                    pass
    except Exception:
        pass


def launch_comfyui():
    """Launch ComfyUI server in the background if not already running."""
    if is_comfyui_running():
        return True, "ComfyUI is already running."

    # Never kill what holds the port: since the single-engine merge (2026-10-29) the
    # engine on :8188 is shared with Pose Studio and Qwen-Edit Studio, and killing it
    # would take their backend down mid-render. Just start one if the port is idle.
    try:
        # Own log file — the ERNIE app's ComfyUI writes /tmp/launcher-comfyui.log,
        # and two servers appending to one file is unreadable.
        log_path = "/tmp/launcher-comfyui-qwen21.log"
        log_file = open(log_path, "a")
        log_file.write(f"[comfyui] Launched by Qwen-Image 2.1 Studio (PID pending)\n")
        log_file.flush()
        proc = subprocess.Popen(
            [COMFY_PYTHON, "main.py", "--port", str(COMFYUI_PORT), "--enable-manager"],
            cwd=COMFY_ROOT,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        log_file.write(f"[comfyui] PID={proc.pid}\n")
        log_file.flush()
        log_file.close()
    except Exception as e:
        return False, f"Failed to start ComfyUI: {e}"

    for _ in range(COMFYUI_LAUNCH_RETRIES):
        time.sleep(2)
        if is_comfyui_running():
            return True, "ComfyUI started successfully."

    return False, "ComfyUI failed to start within timeout."


def save_input_image(pil_img):
    """Save a PIL image to ComfyUI's input directory and return the filename."""
    if pil_img is None:
        return None
    Image = _pil()
    if Image is None:
        raise RuntimeError("PIL is not available")
    _ensure_dirs()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"i2i_input_{timestamp}.png"
    filepath = os.path.join(COMFY_INPUT_DIR, filename)
    pil_img.save(filepath, "PNG")
    return filename


def read_clipboard():
    """Read text from the system clipboard (Wayland or X11)."""
    for cmd in (["wl-paste"], ["xclip", "-selection", "clipboard", "-o"], ["xsel", "-b", "-o"]):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            continue
    return None


def scan_loras():
    """Scan the ComfyUI loras directory and return categorized lists."""
    global LORAS_ALL, LORA_FOLDERS, ROOT_LORAS
    all_loras = ["none"]
    by_folder = {}
    root_loras = []

    if not os.path.isdir(LORAS_ROOT):
        LORAS_ALL, LORA_FOLDERS, ROOT_LORAS = all_loras, by_folder, root_loras
        return LORAS_ALL, LORA_FOLDERS, ROOT_LORAS

    for entry in os.scandir(LORAS_ROOT):
        if entry.is_dir():
            folder_loras = []
            for root, _dirs, files in os.walk(entry.path):
                for f in files:
                    if f.endswith((".safetensors", ".ckpt", ".pt")):
                        rel = os.path.relpath(os.path.join(root, f), LORAS_ROOT).replace("\\", "/")
                        folder_loras.append(rel)
            if folder_loras:
                by_folder[entry.name] = sorted(folder_loras)
                all_loras.extend(folder_loras)
        elif entry.is_file() and entry.name.endswith((".safetensors", ".ckpt", ".pt")):
            root_loras.append(entry.name)
            all_loras.append(entry.name)

    LORAS_ALL = sorted(set(all_loras))
    LORA_FOLDERS = by_folder
    ROOT_LORAS = sorted(root_loras)
    return LORAS_ALL, LORA_FOLDERS, ROOT_LORAS


def get_loras_for_model(unet_name):
    """Return LoRA choices relevant to the selected UNET model."""
    name_lower = unet_name.lower()
    relevant = ["none"]

    if "ernie" in name_lower:
        relevant.extend(LORA_FOLDERS.get("ernie", []))
    elif "z_anime" in name_lower or "z-anime" in name_lower:
        relevant.extend(LORA_FOLDERS.get("zanime", []))
    elif "z_image" in name_lower or "z-image" in name_lower:
        relevant.extend(LORA_FOLDERS.get("zturbo", []))
    elif "krea" in name_lower:
        # Krea-2 LoRAs are in the root loras directory
        relevant.extend(ROOT_LORAS)
    else:
        relevant = list(LORAS_ALL)

    seen = set()
    deduped = []
    for item in relevant:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped


def refresh_models(current_unet=""):
    """Rescan LoRAs + unets from the filesystem."""
    scan_loras()
    loras = get_loras_for_model(current_unet) if current_unet else LORAS_ALL
    info = get_unet_model_info()
    return {
        "unet_models": [m["name"] for m in info],
        "unet_info": info,
        "loras": loras,
        "message": f"Models refreshed — {len(info)} models available.",
    }


def unet_present(unet_name):
    """Check the model really exists on disk before ComfyUI rejects the prompt for it."""
    if not unet_name:
        return False
    return any(os.path.isfile(os.path.join(r, unet_name)) for r in _unet_scan_roots())


# Kept for callers written before safetensors diffusion models were listed.
gguf_present = unet_present


def get_preset(unet_name):
    """Get preset values for a given UNET model."""
    name_lower = unet_name.lower()
    loras = get_loras_for_model(unet_name)

    # The registry is the source of truth: if the user paired this file with an encoder and a
    # VAE in the Models tab, that pairing wins over any name pattern guessed here.
    entry = registry_lookup(unet_name)
    if entry is not None:
        result = registry_entry_preset(entry)
        result["lora1_name"] = result["lora1_name"] if result["lora1_name"] in loras else (
            loras[1] if len(loras) > 1 else "none")
        result["lora2_name"] = result["lora2_name"] if result["lora2_name"] in loras else "none"
        result["loras"] = loras
        return result

    if "qwen_image_2.1" in name_lower or "qwen-image-2.1" in name_lower:
        p = PRESETS.get("qwen21")
    elif "moss" in name_lower:
        p = PRESETS.get("moss_image")
    elif "z_anime" in name_lower or "z-anime" in name_lower:
        p = PRESETS.get("z_anime")
    elif "z_image" in name_lower or "z-image" in name_lower:
        p = PRESETS.get("z_image_turbo")
    elif "moody" in name_lower and "krea" in name_lower:
        # The Krea-2 merge runs with the abliterated Qwen3-VL-4B encoder; stock turbo keeps
        # the stock encoder. Matched before the generic "krea" rule on purpose.
        p = PRESETS.get("krea2_moody")
    elif "krea" in name_lower:
        p = PRESETS.get("krea2_turbo")
    elif "jibmixernie" in name_lower or "jib_mix_ernie" in name_lower:
        p = PRESETS.get("jibMixErnie")
    elif "ernie" in name_lower:
        p = PRESETS.get("ernie")
    else:
        return {"loras": loras}
    if not p:
        return {"loras": loras}

    result = dict(p)
    # lora1_name/lora2_name are optional in a hand-written or stripped preset — a fresh clone's
    # config.example.json has no personal LoRAs in it at all — so read them defensively instead
    # of keying straight into the preset.
    want1 = p.get("lora1_name", "none")
    want2 = p.get("lora2_name", "none")
    result["lora1_name"] = want1 if want1 in loras else (loras[1] if len(loras) > 1 else "none")
    result["lora2_name"] = want2 if want2 in loras else "none"
    result.setdefault("lora1_strength", 0.0)
    result.setdefault("lora2_strength", 0.0)
    result["loras"] = loras
    return result


# ── Aspect ratio helpers ─────────────────────────────────────────
def parse_aspect_ratio(ar_str):
    """Parse aspect ratio string like '9:16', '16:9', or '0.56' into width/height float."""
    ar_str = ar_str.strip()
    if ":" in ar_str:
        parts = ar_str.split(":")
        if len(parts) == 2:
            try:
                w, h = float(parts[0]), float(parts[1])
                if w > 0 and h > 0:
                    return w / h
            except ValueError:
                pass
    try:
        val = float(ar_str)
        if val > 0:
            return val
    except ValueError:
        pass
    return 9 / 16


def format_aspect_ratio(width, height):
    """Format a width/height ratio as a nice string."""
    if height <= 0:
        return "1:1"
    ar = width / height
    common = [
        (1.0, "1:1"), (16 / 9, "16:9"), (9 / 16, "9:16"),
        (4 / 3, "4:3"), (3 / 4, "3:4"), (21 / 9, "21:9"),
        (9 / 21, "9:21"), (2 / 3, "2:3"), (3 / 2, "3:2"),
    ]
    for target, label in common:
        if abs(ar - target) < 0.005:
            return label
    return f"{ar:.3f}"


def calc_dimensions(mp, ar):
    """Calculate width and height from megapixels and aspect ratio."""
    total_pixels = mp * 1_000_000
    width = int((total_pixels * ar) ** 0.5)
    height = int((total_pixels / ar) ** 0.5)
    width = max(DIM_PIXEL_ROUNDING, (width // DIM_PIXEL_ROUNDING) * DIM_PIXEL_ROUNDING)
    height = max(DIM_PIXEL_ROUNDING, (height // DIM_PIXEL_ROUNDING) * DIM_PIXEL_ROUNDING)
    return width, height


def is_gguf_model(unet_name):
    """True when the checkpoint is a GGUF file and must go through UnetLoaderGGUF."""
    return bool(unet_name) and unet_name.lower().endswith(".gguf")


# MOSS-Image is a text-to-image DiT with no image input at all: its ComfyUI graph has no LoadImage,
# no VAEEncode and no reference slots, and its own docs say a reference picture can only reach the
# prompt upsampler. One predicate owns that rule so the graph builder and the API guard cannot
# disagree about it.
TEXT_ONLY_CLIP_TYPES = ("moss_image",)


def is_text_only_clip(clip_type):
    """True for an encoder family that cannot take a picture (MOSS-Image)."""
    return (clip_type or "") in TEXT_ONLY_CLIP_TYPES


# ── Workflow builders ────────────────────────────────────────────
def build_workflow(positive_prompt, width, height, seed, denoise,
                   steps, cfg, scheduler, sampler,
                   lora1_name, lora1_strength, lora2_name, lora2_strength,
                   unet_name, clip_name, clip_type, vae_name,
                   filename_prefix, generation_mode, input_image_filename,
                   upscale=1.0, fmt="api", pag_scale=0.0, ref_image_filenames=None,
                   negative_prompt="", slg=None):
    """Build a workflow dict in API or graph format.

    fmt="api":    Returns {"1": {...}, "2": {...}, ...} for /prompt submission.
    fmt="graph":  Returns {"last_node_id":N, "nodes":[...]} for UI reconstruction.
    """
    out_width = width
    out_height = height
    if generation_mode == "I2I" and upscale != 1.0:
        out_width = round(width * upscale)
        out_height = round(height * upscale)

    # Qwen-Image-2.1 ships as GGUF on this box; the core UNETLoader only reads safetensors.
    unet_loader = "UnetLoaderGGUF" if is_gguf_model(unet_name) else "UNETLoader"
    text_only = is_text_only_clip(clip_type)

    # --- Graph format nodes ---
    if fmt == "graph":
        nodes = [
            {"id": 1, "type": unet_loader, "pos": [40, 40], "size": [320, 100],
             "inputs": [], "outputs": [{"name": "MODEL", "type": "MODEL", "links": []}],
             "widgets_values": [unet_name, "default"]},
            {"id": 2, "type": "CLIPLoader", "pos": [40, 160], "size": [320, 120],
             "inputs": [], "outputs": [{"name": "CLIP", "type": "CLIP", "links": []}],
             "widgets_values": [clip_name, clip_type, "default"]},
            {"id": 3, "type": "VAELoader", "pos": [40, 300], "size": [320, 80],
             "inputs": [], "outputs": [{"name": "VAE", "type": "VAE", "links": []}],
             "widgets_values": [vae_name]},
            {"id": 5, "type": "HashTextClipboard", "pos": [420, 40], "size": [320, 200],
             "inputs": [], "outputs": [{"name": "Text", "type": "STRING", "links": []}],
             "widgets_values": [False, positive_prompt]},
            {"id": 6, "type": ("TextEncodeQwenImage21" if clip_type == "qwen_image" and "2.1" in (unet_name or "").lower() else "DoubleClipTextEncode"), "pos": [800, 40], "size": [340, 160],
             "inputs": [{"name": "clip", "type": "CLIP"}, {"name": "positive_prompt", "type": "STRING"}, {"name": "negative_prompt", "type": "STRING"}],
             "outputs": [{"name": "Positive Conditioning", "type": "CONDITIONING"}, {"name": "Negative Conditioning", "type": "CONDITIONING"}, {"name": "Positive Prompt", "type": "STRING"}, {"name": "Negative Prompt", "type": "STRING"}],
             "widgets_values": []},
            {"id": 7, "type": "ConditioningZeroOut", "pos": [1180, 40], "size": [280, 80],
             "inputs": [{"name": "conditioning", "type": "CONDITIONING"}],
             "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING"}],
             "widgets_values": []},
            {"id": 9, "type": "KSampler", "pos": [800, 300], "size": [340, 340],
             "inputs": [{"name": "model", "type": "MODEL"}, {"name": "positive", "type": "CONDITIONING"}, {"name": "negative", "type": "CONDITIONING"}, {"name": "latent_image", "type": "LATENT"}],
             "outputs": [{"name": "LATENT", "type": "LATENT"}],
             "widgets_values": [seed, "fixed", steps, cfg, sampler, scheduler, denoise]},
            {"id": 10, "type": "VAEDecode", "pos": [1180, 300], "size": [280, 80],
             "inputs": [{"name": "samples", "type": "LATENT"}, {"name": "vae", "type": "VAE"}],
             "outputs": [{"name": "IMAGE", "type": "IMAGE"}],
             "widgets_values": []},
            {"id": 11, "type": "SaveWithMetaData2", "pos": [1500, 300], "size": [360, 340],
             "inputs": [{"name": "images", "type": "IMAGE"}], "outputs": [],
             "widgets_values": [filename_prefix, "png", steps, cfg, unet_name, sampler, scheduler, positive_prompt, "", seed, out_width, out_height, True, 100, ""]},
        ]

        if text_only:
            # MOSS-Image conditions like the template it ships with: two plain CLIPTextEncodes,
            # not the custom DoubleClipTextEncode and never the 2.1 native encoder (its tokenizer
            # wraps the prompt in a chat template). The negative is real here because CFG is > 1.
            for _n in nodes:
                if _n["id"] in (6, 7):
                    _n["type"] = "CLIPTextEncode"
                    _n["inputs"] = [{"name": "clip", "type": "CLIP"}]
                    _n["outputs"] = [{"name": "CONDITIONING", "type": "CONDITIONING", "links": []}]
                    _n["widgets_values"] = [positive_prompt if _n["id"] == 6 else negative_prompt]

        if generation_mode == "I2I" and input_image_filename and not text_only:
            nodes.insert(6, {"id": 8, "type": "LoadImage", "pos": [420, 300], "size": [320, 100],
                 "inputs": [], "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": []}],
                 "widgets_values": [input_image_filename]})
            if upscale != 1.0:
                nodes.insert(7, {"id": 14, "type": "ImageScaleBy", "pos": [420, 520], "size": [320, 80],
                     "inputs": [{"name": "image", "type": "IMAGE"}],
                     "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": []}],
                     "widgets_values": ["lanczos", upscale]})
                nodes.insert(8, {"id": 13, "type": "VAEEncode", "pos": [420, 620], "size": [320, 80],
                     "inputs": [{"name": "pixels", "type": "IMAGE"}, {"name": "vae", "type": "VAE"}],
                     "outputs": [{"name": "LATENT", "type": "LATENT", "links": []}],
                     "widgets_values": []})
            else:
                nodes.insert(7, {"id": 13, "type": "VAEEncode", "pos": [420, 420], "size": [320, 80],
                     "inputs": [{"name": "pixels", "type": "IMAGE"}, {"name": "vae", "type": "VAE"}],
                     "outputs": [{"name": "LATENT", "type": "LATENT", "links": []}],
                     "widgets_values": []})
        else:
            nodes.insert(6, {"id": 8, "type": "EmptyFlux2LatentImage" if text_only else "EmptyLatentImage", "pos": [420, 300], "size": [320, 100],
                 "inputs": [], "outputs": [{"name": "LATENT", "type": "LATENT", "links": []}],
                 "widgets_values": [width, height, 1]})

        if lora1_name and lora1_name != "none":
            nodes.insert(3, {"id": 4, "type": "LoraLoader", "pos": [40, 440], "size": [320, 160],
                 "inputs": [{"name": "model", "type": "MODEL"}, {"name": "clip", "type": "CLIP"}],
                 "outputs": [{"name": "MODEL", "type": "MODEL"}, {"name": "CLIP", "type": "CLIP"}],
                 "widgets_values": [lora1_name, lora1_strength, lora1_strength]})
        if lora2_name and lora2_name != "none":
            nodes.insert(4 if (lora1_name and lora1_name != "none") else 3,
                {"id": 12, "type": "LoraLoader", "pos": [40, 620], "size": [320, 160],
                 "inputs": [{"name": "model", "type": "MODEL"}, {"name": "clip", "type": "CLIP"}],
                 "outputs": [{"name": "MODEL", "type": "MODEL"}, {"name": "CLIP", "type": "CLIP"}],
                 "widgets_values": [lora2_name, lora2_strength, lora2_strength]})

        # Extra references: the node ids match the API graph (22, 23, …) so a downloaded graph
        # and a submitted prompt name the same image slots.
        _graph_refs = [f for f in (ref_image_filenames or []) if f]
        if _graph_refs and clip_type == "qwen_image" and "2.1" in (unet_name or "").lower():
            for idx, ref_name in enumerate(_graph_refs[:15], start=2):
                nodes.append({"id": 20 + idx, "type": "LoadImage", "pos": [420, 620 + 120 * (idx - 2)],
                              "size": [320, 100], "inputs": [],
                              "outputs": [{"name": "IMAGE", "type": "IMAGE", "links": []}],
                              "widgets_values": [ref_name]})

        last_id = 14 if (generation_mode == "I2I" and input_image_filename and upscale != 1.0) else 13 if (generation_mode == "I2I" and input_image_filename) else 12
        if _graph_refs:
            last_id = max(last_id, 20 + len(_graph_refs[:15]))
        return {"last_node_id": last_id, "last_link_id": 0, "nodes": nodes, "links": [], "groups": [], "version": 0.4}

    # --- API format ---
    wf = {}
    def _to_str_ref(v):
        """Convert integer references like [1,0] to string [\"1\",0] for ComfyUI 0.20+."""
        if isinstance(v, list) and len(v) == 2 and isinstance(v[0], int):
            return [str(v[0]), v[1]]
        return v

    def _add(node_id, class_type, **inputs):
        converted = {k: _to_str_ref(v) for k, v in inputs.items()}
        wf[str(node_id)] = {"class_type": class_type, "inputs": converted}

    if unet_loader == "UnetLoaderGGUF":
        # UnetLoaderGGUF takes no weight_dtype; passing one fails prompt validation.
        _add(1, unet_loader, unet_name=unet_name)
    else:
        _add(1, unet_loader, unet_name=unet_name, weight_dtype="default")
    _add(2, "CLIPLoader", clip_name=clip_name, type=clip_type, device="default")
    _add(3, "VAELoader", vae_name=vae_name)
    _add(5, "HashTextClipboard", use_clipboard=False, manual_text=positive_prompt)

    model_ref, clip_ref = [1, 0], [2, 0]
    if lora1_name and lora1_name != "none":
        _add(4, "LoraLoader", lora_name=lora1_name, strength_model=lora1_strength,
             strength_clip=lora1_strength, model=model_ref, clip=clip_ref)
        model_ref, clip_ref = [4, 0], [4, 1]
    if lora2_name and lora2_name != "none":
        _add(12, "LoraLoader", lora_name=lora2_name, strength_model=lora2_strength,
             strength_clip=lora2_strength, model=model_ref, clip=clip_ref)
        model_ref, clip_ref = [12, 0], [12, 1]

    # Qwen-Image 2.1 ships its own conditioning node, which returns a real
    # negative and keeps the 2.1 text-encoder extras (attention_mask /
    # image_slots). The older DoubleClipTextEncode goes through the legacy
    # encode_from_tokens path and is kept for the other models.
    use_native_qwen21 = clip_type == "qwen_image" and "2.1" in (unet_name or "").lower()
    ref_images = [f for f in (ref_image_filenames or []) if f]

    # Image loaders come first: the 2.1 encoder consumes image_1 and every extra
    # reference directly as vision slots, and splices them in as VAE latents.
    if generation_mode == "I2I" and input_image_filename:
        _add(8, "LoadImage", image=input_image_filename)
    if use_native_qwen21:
        for idx, ref_name in enumerate(ref_images[:15], start=2):
            _add(20 + idx, "LoadImage", image=ref_name)

    if text_only:
        # MOSS-Image's own template: plain CLIPTextEncode for both branches (its tokenizer wraps
        # the prompt in the qwen3.5 chat template itself), and a real negative because CFG is 2.5.
        _add(6, "CLIPTextEncode", clip=clip_ref, text=[5, 0])
        _add(7, "CLIPTextEncode", clip=clip_ref, text=negative_prompt)
        pos_ref, neg_ref = [6, 0], [7, 0]
    elif use_native_qwen21:
        # resolution 0 = every reference keeps its own size (rounded to a multiple of
        # 32), and the node hands back an EMPTY latent at that size — 2.1 is
        # conditioned to sample at the reference's size, so a reference that *is* the
        # canvas is what it wants.
        # Any resolution > 0 is an AREA budget, and the node re-derives both sides from
        # it: width = round(sqrt(res^2 * AR) / 32) * 32. That is a second rounding on a
        # 32 grid on top of this app's 64-grid MP+AR size, so the canvas it samples was
        # never the width/height computed here — 1.54 MP @ 9:16 came back 896x1568
        # instead of 896x1600 (-2.0% area), 1 MP @ 9:16 came back 768x1376 instead of
        # 704x1280 (+17.3%). The old canvas-tracking budget was fighting the same
        # problem it caused.
        enc_resolution = 0
        enc_inputs = {"clip": clip_ref, "prompt": [5, 0], "negative_prompt": "",
                      "resolution": enc_resolution}
        if generation_mode == "I2I" and input_image_filename:
            enc_inputs["vae"] = [3, 0]
            enc_inputs["images.image_1"] = [8, 0]
        for idx in range(2, 2 + len(ref_images[:15])):
            enc_inputs["images.image_%d" % idx] = [20 + idx, 0]
        _add(6, "TextEncodeQwenImage21", **enc_inputs)
        pos_ref, neg_ref = [6, 0], [6, 1]
    else:
        _add(6, "DoubleClipTextEncode", clip=clip_ref, positive_prompt=[5, 0], negative_prompt="")
        _add(7, "ConditioningZeroOut", conditioning=[6, 1])
        pos_ref, neg_ref = [6, 0], [7, 0]

    # Latent source must be defined before KSampler references it
    if text_only:
        # MOSS-Image latents are the FLUX.2 layout (128 channels, 16 px grid) — EmptyLatentImage's
        # 4-channel SD latent would decode to noise through its VAE.
        _add(8, "EmptyFlux2LatentImage", width=width, height=height, batch_size=1)
        latent_ref = [8, 0]
    elif use_native_qwen21 and generation_mode == "I2I" and input_image_filename:
        if upscale == 1.0:
            # 2.1's encoder returns an EMPTY latent sized from image_1: `torch.zeros` in
            # nodes_qwen.py, 32-rounded from the first reference. The edit is carried by the
            # reference latents spliced into the conditioning, not by encoding the source,
            # which is why "I2I" here is reference-conditioned generation at image_1's canvas.
            # VAE-encoding the reference and sampling at denoise<1 is the older
            # Qwen-Edit idiom and is not what 2.1 is conditioned for.
            latent_ref = [6, 2]
            denoise = 1.0
        else:
            _add(14, "ImageScaleBy", image=[8, 0], upscale_method="lanczos", scale_by=upscale)
            _add(13, "VAEEncode", pixels=[14, 0], vae=[3, 0])
            latent_ref = [13, 0]
            # The caller's denoise governs here: this branch really does encode the source, so
            # forcing 1.0 would replace the encoded latent with pure noise and make the
            # ImageScaleBy/VAEEncode pair contribute nothing but the size. (Only the empty-latent
            # branch above is unconditionally 1.0 — it has no source latent to keep.)
    elif generation_mode == "I2I" and input_image_filename:
        if upscale != 1.0:
            _add(14, "ImageScaleBy", image=[8, 0], upscale_method="lanczos", scale_by=upscale)
            _add(13, "VAEEncode", pixels=[14, 0], vae=[3, 0])
            latent_ref = [13, 0]
        else:
            _add(13, "VAEEncode", pixels=[8, 0], vae=[3, 0])
            latent_ref = [13, 0]
    else:
        _add(8, "EmptyLatentImage", width=width, height=height, batch_size=1)
        latent_ref = [8, 0]

    # 2.1 keeps the edit prefix in a KV cache; without this node the prefix is
    # recomputed on every step (the node tooltip's "off"). auto = spare VRAM, then RAM.
    if use_native_qwen21:
        _add(16, "QwenImage21Cache", model=model_ref, device="auto", dtype="default")
        model_ref = [16, 0]

    # Optional Skip Layer Guidance — MOSS-Image's official negative-branch skip (uncond skip
    # layers [22], first half of the steps). Its ComfyUI template ships the node switched off, so
    # the preset only enables it when config.json carries an `slg` block.
    if slg and str(slg.get("single_layers", "")).strip():
        _add(17, "SkipLayerGuidanceDiTSimple", model=model_ref,
             double_layers=str(slg.get("double_layers", "")),
             single_layers=str(slg.get("single_layers", "")),
             start_percent=float(slg.get("start", 0.0)),
             end_percent=float(slg.get("end", 0.5)))
        model_ref = [17, 0]

    # Optional Perturbed Attention Guidance (PAG) — patches the model before sampling
    if pag_scale and pag_scale > 0:
        _add(15, "PerturbedAttentionGuidance", model=model_ref, scale=pag_scale)
        model_ref = [15, 0]

    _add(9, "KSampler", seed=seed, control_after_generate="fixed", steps=steps,
         cfg=cfg, sampler_name=sampler, scheduler=scheduler, denoise=denoise,
         model=model_ref, positive=pos_ref, negative=neg_ref, latent_image=latent_ref)
    _add(10, "VAEDecode", samples=[9, 0], vae=[3, 0])
    _add(11, "SaveWithMetaData2", images=[10, 0], filename_prefix=filename_prefix,
         extension="png", steps=steps, cfg=cfg, modelname_string=unet_name,
         sampler_name_string=sampler, scheduler_string=scheduler,
         positive=positive_prompt, negative=negative_prompt, seed_value=seed,
         width=out_width, height=out_height, lossless_webp=True,
         quality_jpeg_or_webp=100, flnm_postfix="")

    return wf
# ══════════════════════════════════════════════════════════════════
#  Post-Process Image Operations (PIL)
# ══════════════════════════════════════════════════════════════════


def apply_levels(img, shadows=0, highlights=255, output_min=0, output_max=255):
    """Map input tonal range [shadows..highlights] to output range [output_min..output_max]."""
    Image = _pil()
    if Image is None:
        return img
    if img.mode != "RGB":
        img = img.convert("RGB")
    arr = np.array(img, dtype=np.float32)
    in_min = float(shadows)
    in_max = float(highlights)
    out_min = float(output_min)
    out_max = float(output_max)
    if in_max <= in_min:
        in_max = in_min + 1
    # Linear mapping
    scale = (out_max - out_min) / (in_max - in_min)
    arr = (arr - in_min) * scale + out_min
    arr = np.clip(arr, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))


def apply_contrast_saturation(img, contrast=1.0, saturation=1.0):
    """Apply contrast and saturation adjustments."""
    Image = _pil()
    ImageEnhance = _pil_image_enhance()
    if Image is None or ImageEnhance is None:
        return img
    if img.mode != "RGB":
        img = img.convert("RGB")
    if contrast != 1.0:
        img = ImageEnhance.Contrast(img).enhance(contrast)
    if saturation != 1.0:
        img = ImageEnhance.Color(img).enhance(saturation)
    return img


def apply_white_balance(img, temperature=0, tint=0):
    """
    Adjust white balance.
    temperature: negative = cooler (more blue), positive = warmer (more red/yellow).
    tint: negative = more green, positive = more magenta.
    """
    Image = _pil()
    if Image is None:
        return img
    if img.mode != "RGB":
        img = img.convert("RGB")
    if temperature == 0 and tint == 0:
        return img
    arr = np.array(img, dtype=np.float32)
    # Temperature: shift red/blue channels
    if temperature != 0:
        arr[:, :, 0] += temperature  # Red
        arr[:, :, 2] -= temperature  # Blue
    # Tint: shift green/magenta (green vs red+blue)
    if tint != 0:
        arr[:, :, 1] -= tint  # Green
        arr[:, :, 0] += tint * 0.5  # Red
        arr[:, :, 2] += tint * 0.5  # Blue
    arr = np.clip(arr, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))


def apply_brilliance(img, brilliance=1.0):
    """
    Multiplicative brightness (brilliance).
    brilliance: 1.0 = neutral, >1 brighter, <1 darker
    """
    Image = _pil()
    if Image is None:
        return img
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    if brilliance == 1.0:
        return img
    arr = np.array(img, dtype=np.float32) * brilliance
    arr = np.clip(arr, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))


def apply_vignette(img, exposure=-0.5, hardness=0.5, scale=1.0, shape=1.0):
    """Apply a vignette darkening effect.
    shape: 0.0 = vertical line (horizontal only), 1.0 = circle, 2.0 = horizontal line (vertical only).
    """
    Image = _pil()
    if Image is None:
        return img
    if img.mode != "RGB":
        img = img.convert("RGB")
    if exposure >= 0:
        return img
    arr = np.array(img, dtype=np.float32)
    h, w = arr.shape[:2]
    cy, cx = h / 2.0, w / 2.0

    yy, xx = np.mgrid[0:h, 0:w]
    dx = np.abs(xx - cx) / (w / 2.0)
    dy = np.abs(yy - cy) / (h / 2.0)

    if shape <= 1.0:
        # 0.0 = vertical line, 1.0 = circle
        dist = np.sqrt(dx * dx + (shape * dy) ** 2) / max(scale, 0.01)
    else:
        # 1.0 = circle, 2.0 = horizontal line
        mult = 2.0 - shape
        dist = np.sqrt((mult * dx) ** 2 + dy * dy) / max(scale, 0.01)

    # Build vignette mask
    mask = np.clip(dist, 0.0, 1.0)
    # hardness controls how quickly the vignette transitions
    # hardness near 0 = sharp edge (only extreme corners darkened)
    # hardness near 1 = very soft gradual falloff
    if hardness > 0.99:
        mask = np.where(mask >= 1.0, 1.0, 0.0)
    elif hardness > 0.01:
        # Power curve: higher hardness = softer (more feather)
        power = 1.0 / max(1.0 - hardness, 0.01)
        mask = np.power(mask, power)
    # Else hardness ≈ 0, keep linear mask

    vig_strength = abs(exposure)
    # exposure is typically negative (darken edges)
    # mask=0 at center, mask=1 at edges
    # We want to darken edges: multiply by (1 - mask * strength)
    factor = 1.0 - mask * min(vig_strength, 1.0)
    factor = np.clip(factor, 0.0, 1.0)
    arr *= factor[:, :, np.newaxis]
    arr = np.clip(arr, 0, 255)
    return Image.fromarray(arr.astype(np.uint8))
