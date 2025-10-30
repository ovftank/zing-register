import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

const getElectronApp = (): { isPackaged: boolean } | undefined => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require('electron');
        return electron.app;
    } catch {
        return undefined;
    }
};

class ZingCaptchaSolver {
    private static readonly CHAR_SET = ['3', '6', '7', '8', '9', 'B', 'D', 'E', 'F', 'H', 'K', 'M', 'N', 'P', 'R', 'T', 'U', 'V', 'W', 'X', 'Y'];
    private static readonly BLANK_LABEL = ZingCaptchaSolver.CHAR_SET.length;
    private static readonly IDX_TO_CHAR = Object.fromEntries(ZingCaptchaSolver.CHAR_SET.map((c, i) => [i, c]));

    private session: ort.InferenceSession | null = null;
    private modelPath: string | null = null;

    private readonly getModelPath = (): string => {
        if (this.modelPath) return this.modelPath;
        const app = getElectronApp();
        this.modelPath = app?.isPackaged ? join(process.resourcesPath, 'models/zing-captcha-crnn-ocr.onnx') : join(process.cwd(), 'models/zing-captcha-crnn-ocr.onnx');
        return this.modelPath;
    };

    async solve(url: string): Promise<string> {
        this.session ??= await ort.InferenceSession.create(this.getModelPath());

        const response = await fetch(url);
        if (!response.ok) throw new Error(`lỗi fetch: ${response.status}`);

        const buffer = Buffer.from(await response.arrayBuffer());
        const { data, info } = await sharp(buffer).resize(200, 50).grayscale().raw().toBuffer({ resolveWithObject: true });

        const normalized = new Float32Array(data.length);
        for (let i = 0; i < data.length; i++) {
            normalized[i] = ((data[i] ?? 0) / 255 - 0.5) / 0.5;
        }

        const inputTensor = new ort.Tensor('float32', normalized, [1, 1, info.height ?? 50, info.width ?? 200]);

        const outputs = await this.session.run({ input: inputTensor });
        const outputTensor = outputs['output'];
        if (!outputTensor?.data || !outputTensor?.dims) {
            throw new Error('lỗi output model');
        }

        const output = outputTensor.data as Float32Array;
        const shape = outputTensor.dims;
        const seqLen = shape[0] ?? 0;
        const numClasses = shape[2] ?? 0;

        const predIdx: number[] = [];
        for (let t = 0; t < seqLen; t++) {
            let maxIdx = 0;
            let maxVal = -Infinity;
            for (let c = 0; c < numClasses; c++) {
                const val = output[t * numClasses + c] ?? -Infinity;
                if (val > maxVal) {
                    maxVal = val;
                    maxIdx = c;
                }
            }
            predIdx.push(maxIdx);
        }

        const result: string[] = [];
        let prev: number | null = null;
        for (const idx of predIdx) {
            if (idx !== ZingCaptchaSolver.BLANK_LABEL && idx !== prev) {
                const char = ZingCaptchaSolver.IDX_TO_CHAR[idx];
                if (char) result.push(char);
            }
            prev = idx;
        }

        return result.join('');
    }
}
export default ZingCaptchaSolver;
