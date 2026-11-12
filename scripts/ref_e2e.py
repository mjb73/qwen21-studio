#!/usr/bin/env python3
"""End-to-end probe for image_2 … image_N (multi-reference edits) on the Qwen 2.1 engine.

Runs against the live engine on :7866 (so it exercises server.py's validation, the
/api/upload_reference cap and shared.build_workflow's encoder wiring), then reads the render back
and measures its mean colour:

  A. image_1 + image_2 (magenta)  -> "make the picture the flat colour in image 2"  => magenta?
  B. image_1 + image_2 + image_3 (green) -> "…the flat colour in image 3"            => green?

A green result in B is only reachable if image_3 reached the encoder after image_2, which is what
the whole change is for. Everything it creates lives under the scratch dir and ~/Pictures/photocraft-ai
is never touched.

    cd ~/personal-files/python-projects/qwen21-studio && .venv/bin/python scripts/ref_e2e.py
"""
import io
import json
import os
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from PIL import Image

HOST = "http://127.0.0.1:7866"
SCRATCH = os.environ.get("REF_E2E_SCRATCH", os.path.join(tempfile.gettempdir(), "ref_e2e"))
COMFY_OUT = os.environ.get("REF_E2E_COMFY_OUT", os.path.expanduser("~/ComfyUI/output"))


def post_json(path, payload):
    req = urllib.request.Request(
        HOST + path, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def post_file(path, filename, blob):
    boundary = "----probe" + uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        "Content-Type: image/png\r\n\r\n"
    ).encode() + blob + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        HOST + path, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def png(img):
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def wait(prompt_id, limit=240):
    start = time.time()
    while time.time() - start < limit:
        with urllib.request.urlopen(f"{HOST}/api/status?prompt_id={prompt_id}", timeout=30) as r:
            st = json.loads(r.read())
        if st.get("state") in ("done", "error") or st.get("image_url") or st.get("filename"):
            return st
        time.sleep(2)
    raise TimeoutError("no result in %ss" % limit)


def mean_colour(name):
    for root, _dirs, files in os.walk(COMFY_OUT):
        if name in files:
            im = Image.open(os.path.join(root, name)).convert("RGB")
            small = im.resize((32, 32))
            px = list(small.getdata())
            n = len(px)
            return tuple(round(sum(c[i] for c in px) / n) for i in range(3)), im.size
    raise FileNotFoundError(name)


def run(label, refs, prompt):
    base = Image.new("RGB", (512, 768))
    for y in range(768):
        for x in range(0, 512, 8):
            base.paste((30 + (x * 120 // 512), 40 + (y * 90 // 768), 60), (x, y, x + 8, y + 1))
    up = post_file("/api/upload_image", "probe_input.png", png(base))
    assert up.get("status") == "ok", up

    filenames = []
    for slot, colour in refs:
        ref = Image.new("RGB", (512, 512), colour)
        up_ref = post_file(f"/api/upload_reference?slot={slot}", f"probe_ref{slot}.png", png(ref))
        print(f"  upload_reference slot {slot}: {up_ref}")
        assert up_ref.get("status") == "ok", up_ref
        filenames.append(up_ref["filename"])

    res = post_json(
        "/api/generate",
        {
            "positive_prompt": prompt,
            "generation_mode": "I2I",
            "input_image_filename": up["filename"],
            "reference_images": filenames,
            "dimension_mode": "Direct",
            "width": 512,
            "height": 768,
            "seed": 42,
            "steps": 8,
            "cfg": 1.0,
            "sampler": "euler",
            "scheduler": "simple",
            "denoise": 1.0,
            "unet_name": "qwen_image_2.1_int8_convrot.safetensors",
            "clip_name": "qwen3vl_8b_int8_convrot.safetensors",
            "clip_type": "qwen_image",
            "vae_name": "qwen_image_2.1_vae_bf16.safetensors",
        },
    )
    print(f"  generate: {res}")
    if res.get("status") != "ok":
        return label, None, None, res
    st = wait(res["prompt_id"])
    print(f"  status: {json.dumps(st)[:400]}")
    name = st.get("filename") or os.path.basename(st.get("image_url", "").split("filename=")[-1])
    colour, size = mean_colour(name)
    return label, colour, size, st


def graph_summary():
    with urllib.request.urlopen(f"{HOST}/workflow-api.json", timeout=20) as r:
        wf = json.loads(r.read())["prompt"]
    enc = wf["6"]["inputs"]
    loads = {k: v["inputs"]["image"] for k, v in wf.items() if v["class_type"] == "LoadImage"}
    slots = {k: v for k, v in enc.items() if k.startswith("images.")}
    return {"LoadImage": loads, "encoder_slots": slots, "latent": wf["9"]["inputs"]["latent_image"]}


def main():
    os.makedirs(SCRATCH, exist_ok=True)
    print("A: image_1 + image_2 (magenta)")
    label, colour, size, st = run("A", [(2, (255, 0, 255))],
                                  "Make this picture entirely the flat colour shown in image 2, "
                                  "with no other content.")
    print("  ->", colour, size)
    print("  graph:", json.dumps(graph_summary()))

    print("B: image_1 + image_2 (magenta) + image_3 (green)")
    label, colour_b, size_b, st_b = run(
        "B", [(2, (255, 0, 255)), (3, (0, 255, 0))],
        "Make this picture entirely the flat colour shown in image 3, with no other content.")
    print("  ->", colour_b, size_b)
    print("  graph:", json.dumps(graph_summary()))

    def verdict(c, target):
        return c is not None and all(abs(c[i] - target[i]) < 70 for i in range(3))

    print()
    print("RESULT")
    print("  A image_2 magenta:", colour, "PASS" if verdict(colour, (255, 0, 255)) else "FAIL")
    print("  B image_3 green  :", colour_b, "PASS" if verdict(colour_b, (0, 255, 0)) else "FAIL")


if __name__ == "__main__":
    main()
