from pathlib import Path
import io
import sys
import os
from typing import Optional
import onnxruntime as ort
from PIL import Image
import numpy as np
import requests
import traceback


def get_base_path():
    if getattr(sys, "frozen", False):
        exe_path = os.path.abspath(sys.executable)
        return Path(os.path.dirname(exe_path))
    return Path(__file__).parent.parent


CHAR_SET = [
    "3",
    "6",
    "7",
    "8",
    "9",
    "B",
    "D",
    "E",
    "F",
    "H",
    "K",
    "M",
    "N",
    "P",
    "R",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
]
BLANK_LABEL = len(CHAR_SET)
IDX_TO_CHAR = dict(enumerate(CHAR_SET))


class ZingCaptchaSolver:
    def __init__(self, model_path=None):
        if model_path is None:
            base_path = get_base_path()
            model_path = base_path / "models" / "zing-captcha-crnn-ocr.onnx"
        self.model_path = Path(model_path)
        self.session: Optional[ort.InferenceSession] = None

    def _load_session(self) -> None:
        if self.session is None:
            self.session = ort.InferenceSession(str(self.model_path))

    def _preprocess(self, img_data: bytes) -> np.ndarray:
        img = Image.open(io.BytesIO(img_data)).convert("L")
        img = img.resize((200, 50))
        img_arr = np.array(img).astype(np.float32) / 255.0
        img_arr = (img_arr - 0.5) / 0.5
        img_arr = img_arr[np.newaxis, np.newaxis, :, :]
        return img_arr

    def _ctc_decode(self, pred_idx: np.ndarray) -> str:
        result = []
        prev = None
        for idx in pred_idx:
            if idx != BLANK_LABEL and idx != prev:
                result.append(IDX_TO_CHAR[idx])
            prev = idx
        return "".join(result)

    def solve(self, url: str) -> str:
        try:
            self._load_session()

            response = requests.get(url, timeout=10)
            response.raise_for_status()

            input_tensor = self._preprocess(response.content)

            if self.session is None:
                raise RuntimeError("session chưa được load")
            outputs = self.session.run(None, {"input": input_tensor})
            output = np.array(outputs[0])

            pred_idx = output.argmax(axis=2).squeeze()

            result = self._ctc_decode(pred_idx)
            return result
        except Exception:
            traceback.print_exc()
            raise
