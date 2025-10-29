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

interface VLCMThreadOptions {
    skipUsernames?: string[];
    onUsernameGenerated?: (username: string) => void;
    gridLayout?: GridLayout;
    proxyUrl?: string;
}

class VLCMThread extends EventEmitter {
    private page: GhostPage | null = null;
    private browser: GhostBrowser | null = null;
    private readonly captchaSolver = new ZingCaptchaSolver();
    private readonly threadId: string;
    private readonly skipUsernames: string[];
    private readonly onUsernameGenerated: (username: string) => void;
    private readonly gridLayout: GridLayout;
    private readonly proxyConfig?: ProxyConfig;

    constructor({ skipUsernames = [], onUsernameGenerated = () => {}, gridLayout, proxyUrl }: VLCMThreadOptions = {}) {
        super();
        this.threadId = crypto.randomUUID();
        this.skipUsernames = skipUsernames;
        this.onUsernameGenerated = onUsernameGenerated;
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
        let username = this.getRandomUsername(usernamePrefix);
        let isUsernameAvailable = false;
        let attempts = 0;
        const maxAttempts = 50;

        while (!isUsernameAvailable && username.length < MAX_USERNAME_LENGTH && attempts < maxAttempts) {
            attempts++;
            if (this.skipUsernames.includes(username)) {
                this.emit('progress', { threadId: this.threadId, message: 'bỏ qua username', username });
                username = this.getRandomUsername(usernamePrefix);
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
                        username = this.getRandomUsername(usernamePrefix);
                    }
                    this.emit('progress', { threadId: this.threadId, message: 'tạo username', username });
                }
            }
        }

        if (!isUsernameAvailable) {
            this.emit('progress', { threadId: this.threadId, message: 'không tìm được username' });
            throw new Error('Could not find an available username.');
        }

        return username;
    };

    private readonly getRandomUsername = (usernamePrefix: string): string => {
        const remainingLength = MAX_USERNAME_LENGTH - usernamePrefix.length;
        const suffixLength = Math.floor(Math.random() * Math.min(5, remainingLength - 1)) + 2;

        const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let suffix = '';
        for (let i = 0; i < suffixLength; i++) {
            suffix += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        return usernamePrefix + suffix;
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
