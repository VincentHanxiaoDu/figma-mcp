"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAuthCookie = checkAuthCookie;
exports.waitForAuthCookie = waitForAuthCookie;
exports.loginFigma = loginFigma;
exports.askFigmaCreds = askFigmaCreds;
const playwright_1 = require("playwright");
const prompts_1 = __importDefault(require("prompts"));
async function checkAuthCookie(context) {
    const cookies = await context.cookies();
    for (const cookie of cookies) {
        if (cookie.name === "__Host-figma.authn") {
            const cookieMap = {};
            for (const c of cookies) {
                cookieMap[c.name] = c.value;
            }
            return cookieMap;
        }
    }
    return null;
}
async function waitForAuthCookie(context, timeoutMs = 300000) {
    const deadline = Date.now() + timeoutMs;
    let cookies = null;
    while (Date.now() < deadline && cookies === null) {
        cookies = await checkAuthCookie(context);
        if (cookies)
            break;
        console.debug("Auth cookie not found yet, waiting...");
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    console.info("Cookies: ", cookies);
    if (!cookies) {
        console.error(`Timeout: Authentication cookie not found within ${timeoutMs / 1000} seconds`);
        return null;
    }
    console.debug("Authentication cookie found! Capturing all cookies...");
    return cookies;
}
async function handleStaySignedIn(page, timeoutMs = 100000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const locator = page.locator('div.row.text-title');
            const element = await locator.first();
            const visible = await element.isVisible({ timeout: 1000 });
            if (visible) {
                const text = await element.textContent();
                if (text?.includes("Stay signed in?")) {
                    console.debug("'Stay signed in?' prompt found, clicking 'Stay signed in'");
                    await (await page.waitForSelector('input[type="submit"]', { state: "visible" })).click();
                    break;
                }
            }
        }
        catch (e) {
            // Keep waiting.
            console.debug("Waiting for 'Stay signed in?' prompt");
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
}
async function loginFigma(email, passwordB64) {
    const password = Buffer.from(passwordB64, "base64").toString("utf-8");
    const browser = await playwright_1.chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("https://www.figma.com/login");
        await (await page.waitForSelector("#email")).fill(email);
        // Page implicitly check account type, wait for 2 seconds.
        await new Promise(resolve => setTimeout(resolve, 2000));
        await (await page.waitForSelector('button[type="submit"]')).click();
        await page.waitForURL("https://login.microsoftonline.com/**", { timeout: 10000 });
        await (await page.waitForSelector('input[type="email"]', { state: "visible" })).fill(email);
        await (await page.waitForSelector('input[type="submit"]', { state: "visible" })).click();
        await page.waitForSelector('#displayName', { state: "visible" });
        await (await page.waitForSelector('input[type="password"]', { state: "visible" })).fill(password);
        await (await page.waitForSelector('input[type="submit"]', { state: "visible" })).click();
        const displaySignText = await (await page.waitForSelector('#idRichContext_DisplaySign', { state: "visible" })).textContent();
        console.log("HUMAN VERIFICATION REQUIRED, enter OTP code: ", displaySignText);
        await handleStaySignedIn(page);
        console.info("Waiting for auth cookie...");
        const cookies = await waitForAuthCookie(context);
        if (!cookies) {
            throw new Error("Failed to login Figma, no auth cookie found");
        }
        const cookieString = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
        console.log("cookies: \n", cookieString);
        return cookieString;
    }
    catch (e) {
        console.warn("Failed to login Figma, error: ", e);
        throw e;
    }
    finally {
        await browser.close();
    }
}
async function askFigmaCreds(defaults) {
    const questions = [
        {
            type: defaults?.username ? null : "text",
            name: "username",
            message: "Enter Figma username:",
            validate: (v) => v?.trim() ? true : "Username is required"
        },
        {
            type: defaults?.passwordB64 ? null : "password",
            name: "password",
            message: "Enter Figma password:",
            validate: (v) => v?.length ? true : "Password is required"
        }
    ];
    const onCancel = () => {
        throw new Error("User cancelled input.");
    };
    const ans = await (0, prompts_1.default)(questions, { onCancel });
    const figmaUsername = defaults?.username ?? ans.username;
    const passwordPlain = defaults?.passwordB64
        ? Buffer.from(defaults.passwordB64, "base64").toString("utf-8")
        : ans.password;
    const figmaPasswordB64 = defaults?.passwordB64 ?? Buffer.from(passwordPlain, "utf-8").toString("base64");
    return { figmaUsername, figmaPasswordB64 };
}
