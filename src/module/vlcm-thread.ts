import ZingCaptchaSolver from '@/module/zing-captcha-solver';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { Browser, LaunchOptions, Page } from 'puppeteer';
import puppeteer from 'puppeteer';

const getElectronApp = (): { isPackaged: boolean } | undefined => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require('electron');
        return electron.app;
    } catch {
        return undefined;
    }
};

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
    private page: Page | null = null;
    private browser: Browser | null = null;
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
            console.log('browser already initialized');
            return;
        }
        try {
            console.log('initializing browser...');
            this.emit('progress', { threadId: this.threadId, message: 'mở trình duyệt...' });
            const app = getElectronApp();
            const extensionPath = app?.isPackaged ? path.join(process.resourcesPath, 'rektCaptcha') : path.join(process.cwd(), 'rektCaptcha');
            console.log('extension path:', extensionPath);
            const launchOptions: LaunchOptions = {
                pipe: true,
                defaultViewport: null,
                headless: false,
                args: [`--window-position=${this.gridLayout.x},${this.gridLayout.y}`, `--window-size=${this.gridLayout.width},${this.gridLayout.height}`, '--disable-features=Translate', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
            };

            if (this.proxyConfig) {
                this.emit('progress', { threadId: this.threadId, message: `dùng proxy: ${this.proxyConfig.server}` });
                launchOptions.args.push(`--proxy-server=${this.proxyConfig.server}`);
            }

            console.log('launch options:', JSON.stringify(launchOptions, null, 2));
            this.browser = await puppeteer.launch(launchOptions);
            console.log('browser launched');
            this.page = await this.browser.newPage();
            console.log('page created');

            if (this.proxyConfig?.username && this.proxyConfig?.password) {
                await this.page.authenticate({
                    username: this.proxyConfig.username,
                    password: this.proxyConfig.password
                });
            }

            await this.page.setViewport({
                width: 1920,
                height: 1080
            });
            console.log('init done');
        } catch (error) {
            console.error('init browser error:', error);
            this.emit('progress', { threadId: this.threadId, message: 'mở fail' });
            throw error;
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

            await this.page?.locator('#reg_account').fill(username);

            this.emit('progress', { threadId: this.threadId, message: `checking username: ${username}` });

            try {
                const response = await this.page?.waitForResponse((res) => res.url().startsWith('https://id.zing.vn/v2/uname-suggestion') && res.url().includes(`username=${username}`), { timeout: 10000 });

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
            } catch {
                this.emit('progress', { threadId: this.threadId, message: `timeout check username: ${username}, clear và gõ lại` });
                await this.page?.locator('#reg_account').fill('');
                username = this.getRandomUsername(usernamePrefix);
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

        try {
            this.emit('progress', { threadId: this.threadId, message: 'vào web' });
            await this.page?.goto('https://vlcm.zing.vn');

            this.emit('progress', { threadId: this.threadId, message: 'bypass tracking' });
            this.emit('progress', { threadId: this.threadId, message: 'wait #zme-registerwg' });
            await this.page?.locator('#zme-registerwg').click();
            const password = this.genRandomPassword();
            this.emit('progress', { threadId: this.threadId, message: 'wait #reg_account (1)' });
            await this.page?.locator('#reg_account').wait();
            await this.page?.addStyleTag({
                content: `#suggestBox{display:none!important}`
            });
            await this.page?.locator('.Close').click();
            await this.page?.locator('#zme-registerwg').click();
            this.emit('progress', { threadId: this.threadId, message: 'wait #reg_account (2)' });
            await this.page?.locator('#reg_account').wait();

            await this.page?.locator('#reg_account').click();

            this.emit('progress', { threadId: this.threadId, message: 'generate username...' });
            const username = await this.generateUsername(usernamePrefix);

            this.emit('progress', { threadId: this.threadId, message: 'input password...' });
            await this.page?.locator('#reg_pwd').fill(password);
            await this.page?.locator('#reg_cpwd').fill(password);

            this.emit('progress', {
                threadId: this.threadId,
                message: 'đang nhập pass',
                username,
                password
            });

            this.emit('progress', { threadId: this.threadId, message: 'giải captcha', username, password });
            const captchaHandle = await this.page?.locator('#captcha').waitHandle();
            if (captchaHandle) {
                this.emit('progress', { threadId: this.threadId, message: 'get captcha src...', username, password });
                const srcProperty = await captchaHandle.getProperty('src');
                const captchaSrc = await srcProperty.jsonValue();

                this.emit('progress', { threadId: this.threadId, message: 'solving captcha...', username, password });
                const result = await this.captchaSolver.solve(captchaSrc as string);
                this.emit('progress', { threadId: this.threadId, message: `captcha: ${result}`, username, password });
                await this.page?.locator('#veryfied_code').fill(result);
            }

            await this.page?.locator('#reg_account').click();
            this.emit('progress', { threadId: this.threadId, message: 'bypass 360game', username, password });
            await this.page?.locator('#btn-register').click();
            this.emit('progress', { threadId: this.threadId, message: 'waiting for 360game redirect...', username, password });
            try {
                await this.page?.waitForRequest((request) => request.url().startsWith('http://360game.vn/auth/login-redirect'), { timeout: 30000 });
                this.emit('progress', { threadId: this.threadId, message: '360game redirect ok', username, password });
            } catch {
                this.emit('progress', { threadId: this.threadId, message: `360game fail, retry...`, username, password });
                try {
                    this.emit('progress', { threadId: this.threadId, message: 'đóng popup...', username, password });
                    await this.page?.locator('.Close').setTimeout(5000).click();

                    this.emit('progress', { threadId: this.threadId, message: 'mở lại form register...', username, password });
                    await this.page?.locator('#zme-registerwg').click();
                    await this.page?.locator('#reg_account').wait();

                    this.emit('progress', { threadId: this.threadId, message: 'nhập lại thông tin...', username, password });
                    await this.page?.locator('#reg_account').fill(username);
                    await this.page?.locator('#reg_pwd').fill(password);
                    await this.page?.locator('#reg_cpwd').fill(password);

                    this.emit('progress', { threadId: this.threadId, message: 'giải captcha (retry)', username, password });
                    const retryCaptchaHandle = await this.page?.locator('#captcha').setTimeout(5000).waitHandle();
                    if (retryCaptchaHandle) {
                        const srcProperty = await retryCaptchaHandle.getProperty('src');
                        const captchaSrc = await srcProperty.jsonValue();
                        const result = await this.captchaSolver.solve(captchaSrc as string);
                        this.emit('progress', { threadId: this.threadId, message: `captcha: ${result}`, username, password });
                        await this.page?.locator('#veryfied_code').fill(result);
                    }

                    await this.page?.locator('#reg_account').click();
                    this.emit('progress', { threadId: this.threadId, message: 'submit lại...', username, password });
                    await this.page?.locator('#btn-register').click();
                    this.emit('progress', { threadId: this.threadId, message: 'chờ 360game redirect (retry)...', username, password });
                    await this.page?.waitForRequest((request) => request.url().startsWith('http://360game.vn/auth/login-redirect'), { timeout: 30000 });
                    this.emit('progress', { threadId: this.threadId, message: '360game redirect ok (retry)', username, password });
                } catch {
                    this.emit('progress', { threadId: this.threadId, message: `retry fail, skip`, username, password });
                }
            }
            this.emit('progress', { threadId: this.threadId, message: 'goto id.zing.vn...', username, password });
            await this.page?.goto('https://id.zing.vn/');

            this.emit('progress', { threadId: this.threadId, message: 'waiting for redirect to inforequire...', username, password });
            try {
                await this.page?.waitForFunction('window.location.href.startsWith("https://id.zing.vn/v2/inforequire?")', { timeout: TIMEOUT_MS });
                this.emit('progress', { threadId: this.threadId, message: 'redirect ok', username, password });
                await this.cleanup();
                this.emit('progress', { threadId: this.threadId, message: 'done', username, password });
                return {
                    username,
                    password
                };
            } catch (error) {
                this.emit('progress', { threadId: this.threadId, message: `fail at inforequire: ${error}`, username, password });
                await this.cleanup();
                return null;
            }
        } catch (error) {
            this.emit('progress', { threadId: this.threadId, message: `error: ${error}` });
            await this.cleanup();
            throw error;
        }
    };
}
export default VLCMThread;
