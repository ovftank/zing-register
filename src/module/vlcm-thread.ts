import ZingCaptchaSolver from '@/module/zing-captcha-solver';
import { app } from 'electron';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { GhostBrowser, GhostPage } from 'puppeteer-ghost';
import puppeteer from 'puppeteer-ghost';

const MAX_USERNAME_LENGTH = 24;
const PASSWORD_LENGTH = 24;
const DEFAULT_GRID_WIDTH = 1024;
const DEFAULT_GRID_HEIGHT = 728;
const PHASE_1 = 1;
const PHASE_2 = 2;
const PHASE_3 = 3;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const TIMEOUT_MS = 5000;

interface GridLayout {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface ProxyConfig {
    server: string;
    username?: string;
    password?: string;
}

class VLCMThread extends EventEmitter {
    private static nextStartIndex = 0;
    private page: GhostPage | null = null;
    private browser: GhostBrowser | null = null;
    private readonly captchaSolver = new ZingCaptchaSolver();
    private readonly threadId: string;
    private readonly skipUsernames: string[];
    private readonly onUsernameGenerated: (username: string) => void;
    private phase: number;
    private index1: number;
    private index2: number;
    private readonly onIndexUpdated: (phase: number, index1: number, index2: number) => void;
    private readonly gridLayout: GridLayout;
    private readonly proxyConfig?: ProxyConfig;

    constructor(skipUsernames: string[] = [], onUsernameGenerated: (username: string) => void = () => {}, initialIndex?: { phase: number; index1: number; index2: number }, onIndexUpdated: (phase: number, index1: number, index2: number) => void = () => {}, gridLayout?: GridLayout, proxyUrl?: string) {
        super();
        this.threadId = crypto.randomUUID();
        this.skipUsernames = skipUsernames;
        this.onUsernameGenerated = onUsernameGenerated;
        if (initialIndex) {
            this.phase = initialIndex.phase;
            this.index1 = initialIndex.index1;
            this.index2 = initialIndex.index2;
        } else {
            this.phase = 1;
            this.index1 = VLCMThread.nextStartIndex % LETTERS.length;
            this.index2 = 0;
            VLCMThread.nextStartIndex++;
        }
        this.onIndexUpdated = onIndexUpdated;
        this.gridLayout = gridLayout ?? { x: 0, y: 0, width: DEFAULT_GRID_WIDTH, height: DEFAULT_GRID_HEIGHT };

        if (proxyUrl) {
            this.proxyConfig = this.parseProxyUrl(proxyUrl);
        }
    }

    private readonly parseProxyUrl = (proxyUrl: string): ProxyConfig | undefined => {
        try {
            if (!proxyUrl || typeof proxyUrl !== 'string') {
                return undefined;
            }
            const parts = proxyUrl.split(':');
            if (parts.length === 2) {
                const [host, port] = parts;
                if (!host || !port || Number.isNaN(Number(port))) {
                    return undefined;
                }
                return {
                    server: `http://${host}:${port}`
                };
            }
            if (parts.length === 4) {
                const [host, port, username, password] = parts;
                if (!host || !port || Number.isNaN(Number(port)) || !username || !password) {
                    return undefined;
                }
                return {
                    server: `http://${host}:${port}`,
                    username,
                    password
                };
            }
            return undefined;
        } catch {
            return undefined;
        }
    };

    cleanup = async (): Promise<void> => {
        if (this.browser) {
            try {
                await this.browser.close();
                this.browser = null;
                this.page = null;
            } catch {
                //
            }
        }
    };
    init = async () => {
        if (this.browser) {
            return;
        }
        try {
            this.emit('progress', { threadId: this.threadId, message: 'mở trình duyệt...' });
            const extensionPath = app.isPackaged ? path.join(process.resourcesPath, 'rektCaptcha') : path.join(process.cwd(), 'rektCaptcha');
            const launchOptions: {
                pipe: boolean;
                enableExtensions: string[];
                args: string[];
                proxy?: ProxyConfig;
            } = {
                pipe: true,
                enableExtensions: [extensionPath],
                args: [`--window-position=${this.gridLayout.x},${this.gridLayout.y}`, `--window-size=${this.gridLayout.width},${this.gridLayout.height}`]
            };

            if (this.proxyConfig) {
                launchOptions.proxy = this.proxyConfig;
                this.emit('progress', { threadId: this.threadId, message: `dùng proxy: ${this.proxyConfig.server}` });
            }

            this.browser = await puppeteer.launch(launchOptions);
            this.page = await this.browser.newPage();
            await this.page.setViewport({
                width: 1920,
                height: 1080
            });
        } catch {
            this.emit('progress', { threadId: this.threadId, message: 'mở fail' });
        }
    };
    private readonly genRandomPassword = () => {
        const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < PASSWORD_LENGTH; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return result;
    };

    private readonly generateUsername = async (usernamePrefix: string): Promise<string> => {
        let username = this.getUsernameFromIndices(usernamePrefix);
        let isUsernameAvailable = false;

        while (!isUsernameAvailable && username.length < MAX_USERNAME_LENGTH) {
            if (this.skipUsernames.includes(username)) {
                this.emit('progress', { threadId: this.threadId, message: 'bỏ qua username', username });
                this.generateNextUsername();
                username = this.getUsernameFromIndices(usernamePrefix);
                this.onIndexUpdated(this.phase, this.index1, this.index2);
                continue;
            }

            await this.page?.$eval('#reg_account', (el) => ((el as HTMLInputElement).value = ''));
            await this.page?.keyboard.type(username);

            const response = await this.page?.waitForResponse((res) => res.url().startsWith('https://id.zing.vn/v2/uname-suggestion') && res.url().includes(`username=${username}`));

            if (response) {
                const responseText = await response.text();
                const startIndex = responseText.indexOf('(');
                const endIndex = responseText.lastIndexOf(')');
                if (startIndex !== -1 && endIndex !== -1) {
                    const jsonString = responseText.substring(startIndex + 1, endIndex);
                    const data = JSON.parse(jsonString);
                    if (data.err === '1') {
                        isUsernameAvailable = true;
                        this.onUsernameGenerated(username);
                    } else {
                        this.generateNextUsername();
                        username = this.getUsernameFromIndices(usernamePrefix);
                    }
                    this.onIndexUpdated(this.phase, this.index1, this.index2);
                    this.emit('progress', { threadId: this.threadId, message: 'tạo username', username });
                }
            }
        }

        return username;
    };

    private readonly generateNextUsername = (): void => {
        if (this.phase === PHASE_1) {
            if (this.index1 < LETTERS.length - 1) {
                this.index1++;
            } else {
                this.phase = PHASE_2;
                this.index1 = 0;
                this.index2 = 0;
            }
        } else if (this.phase === PHASE_2) {
            if (this.index1 < LETTERS.length - 1) {
                this.index2++;
                if (this.index2 >= DIGITS.length) {
                    this.index2 = 0;
                    this.index1++;
                }
            } else {
                this.phase = PHASE_3;
                this.index1 = 0;
                this.index2 = 0;
            }
        } else if (this.phase === PHASE_3) {
            if (this.index1 < LETTERS.length - 1) {
                this.index2++;
                if (this.index2 >= LETTERS.length) {
                    this.index2 = 0;
                    this.index1++;
                }
            } else {
                return;
            }
        }
    };

    private readonly getUsernameFromIndices = (usernamePrefix: string): string => {
        if (this.phase === PHASE_1) {
            return usernamePrefix + LETTERS[this.index1];
        } else if (this.phase === PHASE_2) {
            return usernamePrefix + LETTERS[this.index1] + DIGITS[this.index2];
        } else if (this.phase === PHASE_3) {
            return usernamePrefix + 'z' + LETTERS[this.index1] + LETTERS[this.index2];
        }
        return usernamePrefix;
    };

    registerVLCM = async (usernamePrefix: string) => {
        if (!usernamePrefix || typeof usernamePrefix !== 'string' || usernamePrefix.length < 1) {
            return null;
        }

        this.emit('progress', { threadId: this.threadId, message: 'vào web' });
        await this.page?.goto('https://vlcm.zing.vn');

        this.emit('progress', { threadId: this.threadId, message: 'bypass tracking' });
        await this.page?.waitForSelector('#zme-registerwg');
        await this.page?.click('#zme-registerwg', {
            paddingPercentage: 100
        });
        const password = this.genRandomPassword();
        await this.page?.waitForSelector('#reg_account');
        await this.page?.addStyleTag({
            content: `#suggestBox{display:none!important}`
        });
        await this.page?.click('.Close');
        await this.page?.click('#zme-registerwg', {
            paddingPercentage: 100
        });
        await this.page?.waitForSelector('#reg_account');

        await this.page?.click('#reg_account');

        const username = await this.generateUsername(usernamePrefix);

        await this.page?.click('#reg_pwd');
        await this.page?.keyboard.type(password);

        await this.page?.click('#reg_cpwd');
        await this.page?.keyboard.type(password);

        this.emit('progress', {
            threadId: this.threadId,
            message: 'đang nhập pass',
            username,
            password
        });

        this.emit('progress', { threadId: this.threadId, message: 'giải captcha', username, password });
        const captchaImg = await this.page?.$('#captcha');
        if (captchaImg) {
            const srcProperty = await captchaImg.getProperty('src');
            const captchaSrc = await srcProperty.jsonValue();

            const result = await this.captchaSolver.solve(captchaSrc as string);
            this.emit('progress', { threadId: this.threadId, message: `captcha: ${result}`, username, password });
            await this.page?.click('#veryfied_code');
            await this.page?.keyboard.type(result);
        }

        await this.page?.click('#reg_account');
        this.emit('progress', { threadId: this.threadId, message: 'bypass 360game', username, password });
        await this.page?.click('#btn-register');
        try {
            await this.page?.waitForRequest((request) => request.url().startsWith('http://360game.vn/auth/login-redirect'));
        } catch {
            await this.page.locator('.Close').click({
                count: 2
            });
            await this.page?.click('#zme-registerwg', {
                paddingPercentage: 100
            });
            await this.page?.waitForSelector('#reg_account');

            await this.page?.click('#reg_account');
            await this.page?.keyboard.type(username);

            await this.page?.click('#reg_pwd');
            await this.page?.keyboard.type(password);

            await this.page?.click('#reg_cpwd');
            await this.page?.keyboard.type(password);

            this.emit('progress', {
                threadId: this.threadId,
                message: 'đang nhập pass',
                username,
                password
            });

            this.emit('progress', { threadId: this.threadId, message: 'giải captcha', username, password });
            const captchaImg = await this.page?.$('#captcha');
            if (captchaImg) {
                const srcProperty = await captchaImg.getProperty('src');
                const captchaSrc = await srcProperty.jsonValue();

                const result = await this.captchaSolver.solve(captchaSrc as string);
                this.emit('progress', { threadId: this.threadId, message: `captcha: ${result}`, username, password });
                await this.page?.click('#veryfied_code');
                await this.page?.keyboard.type(result);
            }

            await this.page?.click('#reg_account');
            this.emit('progress', { threadId: this.threadId, message: 'bypass 360game', username, password });
            await this.page?.click('#btn-register');
            await this.page?.waitForRequest((request) => request.url().startsWith('http://360game.vn/auth/login-redirect'));
        }
        await this.page?.goto('https://id.zing.vn/');

        try {
            await this.page?.waitForFunction('window.location.href.startsWith("https://id.zing.vn/v2/inforequire?")', { timeout: TIMEOUT_MS });
            await this.cleanup();
            this.emit('progress', { threadId: this.threadId, message: 'done', username, password });
            return {
                username,
                password
            };
        } catch {
            this.emit('progress', { threadId: this.threadId, message: 'fail', username, password });
            return null;
        }
    };
}
export default VLCMThread;
