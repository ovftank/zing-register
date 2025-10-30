import VLCMThread from '@/module/vlcm-thread.js';
import { execSync } from 'node:child_process';

const getScreenResolution = () => {
    try {
        const output = execSync('wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'ignore']
        });

        const lines = output.trim().split('\n');
        if (lines.length >= 2) {
            const values = lines[1].trim().split(/\s+/);
            if (values.length >= 2) {
                return {
                    width: Number.parseInt(values[0], 10) || 1920,
                    height: Number.parseInt(values[1], 10) || 1080
                };
            }
        }
    } catch {
        //
    }
    return { width: 1920, height: 1080 };
};

const calculateGridLayout = (numWindows: number, screenWidth: number, screenHeight: number) => {
    const cols = Math.ceil(Math.sqrt(numWindows));
    const rows = Math.ceil(numWindows / cols);

    const windowWidth = Math.floor(screenWidth / cols);
    const windowHeight = Math.floor(screenHeight / rows);

    return { cols, rows, windowWidth, windowHeight };
};

const getWindowPosition = (index: number, cols: number, windowWidth: number, windowHeight: number) => {
    const row = Math.floor(index / cols);
    const col = index % cols;

    return {
        x: col * windowWidth,
        y: row * windowHeight
    };
};

const test = async () => {
    const usernamePrefix = 'conga';
    const numThreads = 2;
    const accountLimit = 2;
    const proxies: string[] = [];

    const { width: screenWidth, height: screenHeight } = getScreenResolution();
    console.log(`screen resolution: ${screenWidth}x${screenHeight}`);

    const { cols, windowWidth, windowHeight } = calculateGridLayout(numThreads, screenWidth, screenHeight);
    console.log(`grid layout: ${cols} cols, ${windowWidth}x${windowHeight} per window\n`);

    const skipUsernames: string[] = [];
    const allResults: Array<{ username: string; password: string } | null> = [];
    let successCount = 0;
    let proxyIndex = 0;

    while (successCount < accountLimit) {
        const threads: Promise<{ username: string; password: string } | null>[] = [];
        const remainingSlots = accountLimit - successCount;
        const currentBatchSize = Math.min(numThreads, remainingSlots);

        for (let i = 0; i < currentBatchSize; i++) {
            const position = getWindowPosition(i, cols, windowWidth, windowHeight);
            let proxyUrl: string | undefined = undefined;
            if (proxies.length > 0) {
                proxyUrl = proxies[proxyIndex % proxies.length];
                proxyIndex++;
            }

            const threadPromise = (async () => {
                try {
                    const onUsernameGenerated = (username: string) => {
                        skipUsernames.push(username);
                    };
                    const vlcmThread = new VLCMThread({
                        skipUsernames,
                        onUsernameGenerated,
                        gridLayout: {
                            x: position.x,
                            y: position.y,
                            width: windowWidth,
                            height: windowHeight
                        },
                        proxyUrl
                    });

                    vlcmThread.on('progress', ({ threadId, message, username, password }) => {
                        console.log(`[${threadId.slice(0, 8)}] ${message}`);
                        if (username) console.log(`  username: ${username}`);
                        if (password) console.log(`  password: ${password}`);
                    });

                    await vlcmThread.init();
                    const result = await vlcmThread.registerVLCM(usernamePrefix);
                    if (result) {
                        skipUsernames.push(result.username);
                    }
                    return result;
                } catch (error) {
                    console.error('thread error:', error);
                    return null;
                }
            })();

            threads.push(threadPromise);
        }

        const batchResults = await Promise.all(threads);
        allResults.push(...batchResults);

        for (const result of batchResults) {
            if (result) {
                successCount++;
            }
        }

        if (successCount >= accountLimit) {
            break;
        }
    }

    console.log('\n=== results ===');
    console.log(`success: ${allResults.filter((r) => r !== null).length}/${accountLimit}`);
    for (const [idx, result] of allResults.entries()) {
        if (result) {
            console.log(`${idx + 1}. ${result.username} | ${result.password}`);
        }
    }

    process.exit(0);
};

test();
