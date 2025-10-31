import math
import os
import shutil
import sys
import tempfile
import psutil
import time
from pathlib import Path

from playwright.sync_api import (
    TimeoutError as PlaywrightTimeoutError,
)
from playwright.sync_api import (
    ViewportSize,
    sync_playwright,
)
from playwright_stealth import Stealth
from python_ghost_cursor.playwright_sync import create_cursor, install_mouse_helper
from screeninfo import get_monitors

from utils import ZingCaptchaSolver, generate_password, generate_username


def get_base_path():
    if getattr(sys, "frozen", False):
        exe_path = os.path.abspath(sys.executable)
        return Path(os.path.dirname(exe_path))
    return Path(__file__).parent.parent


ZME_REGISTER_BTN_SELECTOR = "#zme-registerwg"
CLOSE_BTN_SELECTOR = ".Close"
REG_ACCOUNT_SELECTOR = "#reg_account"
REG_PASSWORD_SELECTOR = "#reg_pwd"
REG_CONFIRM_PASSWORD_SELECTOR = "#reg_cpwd"
REG_BTN = "#btn-register"
TIMEOUT_MS = 5000


CAPTCHA_SELECTOR = "#captcha"
VERIFIED_CODE_SELECTOR = "#veryfied_code"


class VLCMThread:
    def __init__(
        self,
        prefix="",
        password=None,
        password_length=8,
        skip_usernames=None,
        thread_index=0,
        total_threads=1,
        proxy=None,
    ):
        self.prefix = prefix
        self.password = password
        self.password_length = password_length
        self.skip_usernames = skip_usernames or []
        self.stealth = Stealth()
        self.captcha_solver = ZingCaptchaSolver()
        self.thread_index = thread_index
        self.total_threads = total_threads

        self.thread_id = f"vlcm_thread_{thread_index}_{int(time.time())}"
        self.playwright = sync_playwright().start()

        base_path = get_base_path()
        source_extension_path = base_path / "rektCaptcha"

        if not source_extension_path.exists():
            raise FileNotFoundError(
                f"extension path không tồn tại: {source_extension_path}"
            )

        self.temp_dir = tempfile.TemporaryDirectory(prefix="vlcm")
        self.user_data_dir = self.temp_dir.name
        temp_extension_path = Path(self.temp_dir.name) / "rektCaptcha"
        shutil.copytree(source_extension_path, temp_extension_path)
        extension_path_str = str(temp_extension_path.absolute())

        monitors = get_monitors()
        primary_monitor = next(
            (m for m in monitors if m.is_primary), monitors[0] if monitors else None
        )

        if primary_monitor:
            work_area_height = primary_monitor.height - 48
            aspect_ratio = primary_monitor.width / work_area_height

            candidates = [
                (cols, self.total_threads // cols)
                for cols in range(1, self.total_threads + 1)
                if self.total_threads % cols == 0
            ]
            cols, rows = min(candidates, key=lambda x: abs(x[0] / x[1] - aspect_ratio))

            col, row = self.thread_index % cols, self.thread_index // cols
            window_width, window_height = (
                primary_monitor.width // cols,
                work_area_height // rows,
            )
            window_x = primary_monitor.x + (col * window_width)
            window_y = primary_monitor.y + (row * window_height)
            window_position, window_size = (
                f"{window_x},{window_y}",
                f"{window_width},{window_height}",
            )
        else:
            window_width, window_height = 800, 600
            window_position, window_size = (
                f"{20 + self.thread_index * 500},{100}",
                "800,600",
            )

        viewport_size: ViewportSize = {
            "width": window_width,
            "height": window_height,
        }

        proxy_config = None
        if proxy:
            host, port, username, password = proxy.split(":")
            proxy_config = {
                "server": f"{host}:{port}",
                "username": username,
                "password": password,
            }

        launch_kwargs = {
            "user_data_dir": self.user_data_dir,
            "headless": False,
            "channel": "chromium",
            "accept_downloads": False,
            "viewport": viewport_size,
            "args": [
                f"--window-position={window_position}",
                f"--window-size={window_size}",
                f"--disable-extensions-except={extension_path_str}",
                f"--load-extension={extension_path_str}",
            ],
        }

        if proxy_config:
            launch_kwargs["proxy"] = proxy_config

        self.context = self.playwright.chromium.launch_persistent_context(
            **launch_kwargs
        )

        self.stealth.apply_stealth_sync(self.context)

        self.page = self.context.new_page()
        install_mouse_helper(self.page)
        self.cursor = create_cursor(self.page)

    def click_center(self, selector: str):
        elem = self.page.locator(selector)
        elem.wait_for(timeout=5000)
        elem.scroll_into_view_if_needed()

        box = elem.bounding_box()
        if box is None:
            raise ValueError(f"k lay dc bounding box cua {selector}")

        x = box.get("x", 0)
        y = box.get("y", 0)
        width = box.get("width", 0)
        height = box.get("height", 0)

        if (
            math.isnan(x)
            or math.isnan(y)
            or math.isnan(width)
            or math.isnan(height)
            or not math.isfinite(x)
            or not math.isfinite(y)
            or not math.isfinite(width)
            or not math.isfinite(height)
            or width <= 0
            or height <= 0
        ):
            elem.click()
            return

        center_x = x + width / 2
        center_y = y + height / 2

        self.cursor.move_to({"x": center_x, "y": center_y})
        self.cursor.click(None)

    def register(self):
        try:
            self.page.goto("https://vlcm.zing.vn")

            self.click_center(ZME_REGISTER_BTN_SELECTOR)

            try:
                self.page.locator(CLOSE_BTN_SELECTOR).wait_for(timeout=2000)
                self.click_center(CLOSE_BTN_SELECTOR)
            except Exception:
                pass

            self.click_center(ZME_REGISTER_BTN_SELECTOR)

            username = generate_username(
                self.prefix, skip_usernames=self.skip_usernames
            )
            password_str = (
                generate_password(self.password_length)
                if not self.password
                else self.password
            )

            self.page.locator(REG_ACCOUNT_SELECTOR).click()
            self.page.locator(REG_ACCOUNT_SELECTOR).fill(username)

            self.page.locator(REG_PASSWORD_SELECTOR).click()
            self.page.locator(REG_PASSWORD_SELECTOR).fill(password_str)

            self.page.locator(REG_CONFIRM_PASSWORD_SELECTOR).click()
            self.page.locator(REG_CONFIRM_PASSWORD_SELECTOR).fill(password_str)

            self.page.locator(REG_ACCOUNT_SELECTOR).click()

            try:
                captcha_locator = self.page.locator(CAPTCHA_SELECTOR)
                captcha_locator.wait_for(timeout=2000)
                captcha_src = captcha_locator.get_attribute("src")
                if captcha_src:
                    captcha_result = self.captcha_solver.solve(captcha_src)
                    self.page.locator(VERIFIED_CODE_SELECTOR).fill(captcha_result)
            except Exception:
                pass

            try:
                with self.page.expect_request(
                    lambda req: req.url.startswith(
                        "http://360game.vn/auth/login-redirect"
                    ),
                    timeout=30000,
                ):
                    self.page.locator(REG_BTN).dblclick()
            except PlaywrightTimeoutError:
                try:
                    try:
                        self.page.locator(CLOSE_BTN_SELECTOR).wait_for(timeout=2000)
                        self.click_center(CLOSE_BTN_SELECTOR)
                    except Exception:
                        pass

                    self.click_center(ZME_REGISTER_BTN_SELECTOR)
                    self.page.locator(REG_ACCOUNT_SELECTOR).wait_for()

                    self.page.locator(REG_ACCOUNT_SELECTOR).fill(username)
                    self.page.locator(REG_PASSWORD_SELECTOR).fill(password_str)
                    self.page.locator(REG_CONFIRM_PASSWORD_SELECTOR).fill(password_str)

                    try:
                        captcha_locator = self.page.locator(CAPTCHA_SELECTOR)
                        captcha_locator.wait_for(timeout=2000)
                        captcha_src = captcha_locator.get_attribute("src")
                        if captcha_src:
                            captcha_result = self.captcha_solver.solve(captcha_src)
                            self.page.locator(VERIFIED_CODE_SELECTOR).fill(
                                captcha_result
                            )
                    except Exception:
                        pass

                    self.page.locator(REG_ACCOUNT_SELECTOR).click()
                    with self.page.expect_request(
                        lambda req: req.url.startswith(
                            "http://360game.vn/auth/login-redirect"
                        ),
                        timeout=30000,
                    ):
                        self.page.locator(REG_BTN).dblclick()
                except Exception:
                    return None
            self.page.goto("https://id.zing.vn/")
            try:
                self.page.wait_for_function(
                    'window.location.href.startsWith("https://id.zing.vn/v2/inforequire?")',
                    timeout=TIMEOUT_MS,
                )
                return {"username": username, "password": password_str}
            except PlaywrightTimeoutError:
                return None
        except Exception:
            return None

    def close(self):
        try:
            if hasattr(self, "page") and self.page and not self.page.is_closed():
                self.page.close()

            if hasattr(self, "context") and self.context:
                self.context.close()

            if hasattr(self, "playwright") and self.playwright:
                try:
                    self.playwright.stop()
                except Exception:
                    pass

            if hasattr(self, "temp_dir") and self.temp_dir:
                self.temp_dir.cleanup()

            self._kill_node_processes()
        except Exception:
            pass

    def _kill_node_processes(self):
        try:
            for proc in psutil.process_iter(["pid", "name", "cmdline"]):
                try:
                    if proc.info["name"] == "node.exe":
                        cmdline = proc.info.get("cmdline", [])
                        cmdline_str = " ".join(cmdline)

                        if (
                            "playwright" in cmdline_str
                            and hasattr(self, "user_data_dir")
                            and self.user_data_dir in cmdline_str
                        ):
                            current_time = time.time()
                            process_age_seconds = current_time - proc.create_time()
                            if process_age_seconds > 60:
                                proc.kill()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
        except Exception:
            pass
