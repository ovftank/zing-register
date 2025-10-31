# z-register [@ovftank](https://t.me/ovftank)

## build command [pyinstaller](https://playwright.dev/python/docs/library#pyinstaller)

```bash
set PLAYWRIGHT_BROWSERS_PATH=0
uv run playwright install chromium --no-shell --with-deps
uv run pyinstaller --noconfirm --onefile --console --icon "./favicon.ico" --log-level "WARN" --collect-all playwright_stealth --collect-all python_ghost_cursor "./main.py"
```

Output: `dist/` folder
