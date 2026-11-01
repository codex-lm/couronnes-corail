import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = 'http://127.0.0.1:8765/'
results = {'desktop': {}, 'mobile': {}, 'autoplay': {}, 'consoleErrors': []}


def state(page):
    return page.evaluate('() => window.Couronnes.getState()')


def wait_ready(page):
    page.wait_for_function('() => Boolean(window.Couronnes)', timeout=15000)


def wait_human(page):
    page.wait_for_function('() => { const s = window.Couronnes.getState(); return s && s.factions[s.currentFaction].human && !document.querySelector("#end-turn").disabled; }', timeout=20000)


def watch(page, label):
    page.on('pageerror', lambda error: results['consoleErrors'].append({'page': label, 'text': str(error)}))
    page.on('console', lambda message: results['consoleErrors'].append({'page': label, 'text': message.text}) if message.type == 'error' else None)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 720})
    page = context.new_page()
    watch(page, 'desktop')
    page.goto(URL, wait_until='networkidle')
    wait_ready(page)
    page.locator('#new-game').click()
    page.wait_for_selector('#game:not([hidden])')
    page.evaluate("() => window.Couronnes.selectTile('2,1')")
    page.locator('[data-found]').click()
    current = state(page)
    assert len([port for port in current['ports'] if port['factionId'] == 'nacre']) == 2
    expansion = [port for port in current['ports'] if port['tileId'] == '2,1'][0]
    assert len(expansion['worked']) >= 1
    results['desktop']['colonization'] = {'ports': 2, 'worked': expansion['worked']}

    page.locator('[data-queue-id="scout"]').click()
    page.locator('#research-button').click()
    page.locator('[data-research="star_charts"]').click()
    current = state(page)
    assert current['factions'][0]['research']['techId'] == 'star_charts'
    assert current['factions'][0]['resources']['materials'] == 5
    queued = [port for port in current['ports'] if port['tileId'] == '2,1'][0]['queue']
    assert len(queued) == 1 and queued[0]['typeId'] == 'scout'
    results['desktop']['productionAndResearch'] = {'queue': queued, 'research': 'star_charts', 'materials': 5}

    scout = [unit for unit in current['units'] if unit['factionId'] == 'nacre' and unit['type'] == 'scout'][0]
    page.evaluate("() => window.Couronnes.selectTile('1,2')")
    page.evaluate("() => window.Couronnes.selectTile('5,0')")
    current = state(page)
    scout = [unit for unit in current['units'] if unit['id'] == scout['id']][0]
    assert scout['tileId'] == '5,0'
    assert current['factions'][0]['resources']['provisions'] == 9
    results['desktop']['movement'] = {'tile': scout['tileId'], 'provisions': 9}

    page.locator('#end-turn').click()
    wait_human(page)
    current = state(page)
    assert current['round'] == 2
    assert current['factions'][0]['research']['turnsLeft'] == 1
    assert len(current['units']) == 4
    results['desktop']['turnAdvance'] = {'round': 2, 'researchTurnsLeft': 1, 'units': 4}

    page.goto(URL, wait_until='networkidle')
    wait_ready(page)
    page.locator('#continue-game').click()
    wait_human(page)
    restored = state(page)
    assert restored['round'] == 2
    assert restored['gameId'] == current['gameId']
    assert len([port for port in restored['ports'] if port['factionId'] == 'nacre']) == 2
    results['desktop']['saveReload'] = {'round': 2, 'sameGame': True}

    for language, expected in [('fr', 'Couronner l’archipel'), ('es', 'Coronar el archipiélago'), ('en', 'Crown the archipelago')]:
        page.locator('.top-actions .language-select').select_option(language)
        page.wait_for_timeout(100)
        assert page.locator('#objectives h3').inner_text() == expected
    results['desktop']['languages'] = ['en', 'fr', 'es']
    page.locator('#help-button').click()
    assert page.locator('#modal').is_visible()
    assert page.locator('.help-section').count() == 7
    page.locator('#modal-close').click()
    results['desktop']['integratedHelpSections'] = 7

    for expected_round in (3, 4, 5):
        page.locator('#end-turn').click()
        page.wait_for_function(f'() => window.Couronnes.getState().round >= {expected_round}')
        wait_human(page)
    current = state(page)
    assert current['tide'] == 'rising'
    results['desktop']['tideAtRoundFive'] = current['tide']
    page.screenshot(path=str(ROOT / 'evidence' / 'desktop-turn-5.png'), full_page=True)

    page.goto(URL + '?autoplay=1', wait_until='networkidle')
    wait_ready(page)
    page.wait_for_function('() => document.body.dataset.gameover === "true"', timeout=60000)
    final = state(page)
    assert final['winner']
    assert final['winReason']
    assert all(len([port for port in final['ports'] if port['factionId'] == faction['id']]) <= 4 for faction in final['factions'])
    saved = page.evaluate('() => JSON.parse(localStorage.getItem("couronnes-corail.save.v1"))')
    assert saved['round'] == 5
    results['autoplay'] = {'winner': final['winner'], 'reason': final['winReason'], 'round': final['round'], 'manualSavePreservedAtRound': saved['round']}
    page.screenshot(path=str(ROOT / 'evidence' / 'browser-gameover.png'), full_page=True)
    previous_id = final['gameId']
    page.locator('[data-confirm-new]').last.click()
    page.wait_for_function('() => document.body.dataset.gameover === "false"')
    assert state(page)['gameId'] != previous_id
    results['autoplay']['restart'] = True
    context.close()

    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    touch = mobile.new_page()
    watch(touch, 'mobile')
    touch.goto(URL, wait_until='networkidle')
    wait_ready(touch)
    touch.locator('#new-game').tap()
    touch.wait_for_selector('#game:not([hidden])')
    touch.evaluate("() => window.Couronnes.selectTile('2,1')")
    touch.locator('[data-found]').tap()
    mobile_state = state(touch)
    assert len([port for port in mobile_state['ports'] if port['factionId'] == 'nacre']) == 2
    results['mobile'] = {'touchColonization': True, 'canvas': touch.locator('#map').evaluate('(element) => ({width: element.width, height: element.height})'), 'consoleErrors': []}
    touch.screenshot(path=str(ROOT / 'evidence' / 'mobile-port.png'), full_page=True)
    mobile.close()
    browser.close()

(ROOT / 'evidence' / 'browser-journey.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
print(json.dumps(results, indent=2))
if results['consoleErrors']:
    raise SystemExit(1)
