import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get('CORAL_URL', 'http://127.0.0.1:8765/')
MOBILE = os.environ.get('CORAL_MOBILE', '1') == '1'
SCREENSHOT = ROOT / 'evidence' / ('mobile-game.png' if MOBILE else 'desktop-game.png')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={'width': 390 if MOBILE else 1280, 'height': 844 if MOBILE else 720},
        device_scale_factor=2 if MOBILE else 1,
        is_mobile=MOBILE,
        has_touch=MOBILE,
    )
    page = context.new_page()
    messages = []
    page.on('pageerror', lambda error: messages.append({'type': 'pageerror', 'text': str(error)}))
    page.on('console', lambda message: messages.append({'type': message.type, 'text': message.text}) if message.type == 'error' else None)
    response = page.goto(URL, wait_until='networkidle')
    page.wait_for_function('() => Boolean(window.Couronnes)', timeout=15000)
    initialized = page.evaluate('() => ({ready: document.readyState, title: document.title, newGame: typeof window.Couronnes.newGame})')
    page.locator('#new-game').click()
    page.wait_for_selector('#game:not([hidden])', timeout=10000)
    page.wait_for_timeout(800)
    result = {
        'httpStatus': response.status if response else None,
        'mobile': MOBILE,
        'initialized': initialized,
        'turn': page.locator('#turn-label').inner_text(),
        'menuHidden': page.locator('#menu-screen').evaluate('(element) => element.hidden'),
        'gameVisible': page.locator('#game').is_visible(),
        'canvas': page.locator('#map').evaluate('(element) => ({width: element.width, height: element.height})'),
        'endTurnEnabled': page.locator('#end-turn').is_enabled(),
        'consoleErrors': messages,
    }
    page.screenshot(path=str(SCREENSHOT), full_page=True)
    print(json.dumps(result, indent=2))
    context.close()
    browser.close()
    if messages:
        raise SystemExit(1)
