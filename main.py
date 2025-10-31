from utils import VLCMThread
import threading
import traceback
import subprocess
import os
from pathlib import Path
import warnings
import json
import sys
import time
import signal

warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", message=".*Roundoff error.*")

write_lock = threading.Lock()
count_lock = threading.Lock()
proxy_lock = threading.Lock()
created_count = 0
proxy_index = 0

DEFAULT_LOG_FILE = "status.log"


def update_title(count):
    try:
        os.system(f"title da tao: {count} tk")
    except Exception:
        pass


def load_proxies():
    proxy_file = Path("proxies.txt")
    if not proxy_file.exists():
        demo_content = (
            "# ví dụ(k có # ở đầu):\n"
            "# vutrinh.trungdungth.top:1003:suaongtho:thogl123\n"
            "# vutrinh.trungdungth.top:1004:suaongtho:thogl123\n"
        )
        try:
            with open(proxy_file, "w", encoding="utf-8") as f:
                f.write(demo_content)
        except Exception:
            traceback.print_exc()
        return []

    proxies = []
    try:
        with open(proxy_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    proxies.append(line)
    except Exception:
        traceback.print_exc()

    return proxies


def get_next_proxy(proxies):
    global proxy_index
    if not proxies:
        return None

    with proxy_lock:
        proxy = proxies[proxy_index]
        proxy_index = (proxy_index + 1) % len(proxies)
        return proxy


def write_account(username, password, account_limit):
    global created_count
    with count_lock:
        if account_limit is not None and created_count >= account_limit:
            return False

        with write_lock:
            try:
                with open("acc.txt", "a", encoding="utf-8") as f:
                    f.write(f"{username}:{password}\n")
                    f.flush()

                created_count += 1
                print(f"da tao: {created_count} tk")
                update_title(created_count)
                return True
            except Exception:
                traceback.print_exc()
                return False


def log_status(message, log_file=DEFAULT_LOG_FILE):
    try:
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def signal_handler(sig, frame):
    log_status("Chương trình nhận tín hiệu shutdown")
    sys.exit(0)


signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


def run_thread(
    thread_index,
    prefix,
    password,
    password_length,
    total_threads,
    account_limit,
    proxy=None,
):
    thread = None
    try:
        thread = VLCMThread(
            prefix=prefix,
            password=password,
            password_length=password_length,
            thread_index=thread_index,
            total_threads=total_threads,
            proxy=proxy,
        )
        result = thread.register()

        if result:
            write_account(result["username"], result["password"], account_limit)
    except Exception as e:
        log_status(f"Thread {thread_index}: exception - {str(e)}", DEFAULT_LOG_FILE)
        traceback.print_exc()
    finally:
        if thread:
            try:
                thread.close()
                log_status(
                    f"Thread {thread_index}: đã đóng thread thành công",
                    DEFAULT_LOG_FILE,
                )
            except Exception as e:
                log_status(
                    f"Thread {thread_index}: lỗi khi đóng thread - {str(e)}",
                    DEFAULT_LOG_FILE,
                )


if __name__ == "__main__":
    update_title(0)
    proxies = load_proxies()

    try:
        with open("config.json", "r", encoding="utf-8") as f:
            config = json.load(f)
        prefix = config.get("prefix", "").strip()
        want_random_pass = config.get("random_password", True)
        want_random_pass_str = "y" if want_random_pass else "n"
        password_length = config.get("password_length", 8)
        total_threads = config.get("threads", 1)
        account_limit = config.get("account_limit")
        restart_after_minutes = config.get("restart_after_minutes", 0)
        log_file = config.get("log_file", DEFAULT_LOG_FILE)
        log_status(
            f"Chương trình bắt đầu với config: prefix={prefix}, threads={total_threads}, limit={account_limit}, restart_after={restart_after_minutes}",
            log_file
        )
    except FileNotFoundError:
        log_status("config.json not found. Please create one.", DEFAULT_LOG_FILE)
        sys.exit(1)
    except json.JSONDecodeError:
        log_status("Error decoding config.json. Please check its format.", DEFAULT_LOG_FILE)
        sys.exit(1)
    except Exception:
        log_status(f"Lỗi khởi tạo: {str(traceback.format_exc())}", DEFAULT_LOG_FILE)
        sys.exit(1)

    start_time = time.time()

    password = None
    if want_random_pass_str not in ("y", "yes"):
        password = config.get("password") or None
    else:
        if password_length < 1:
            password_length = 8

    try:
        total_threads = int(total_threads)
    except ValueError:
        total_threads = 1

    try:
        account_limit = int(account_limit) if account_limit is not None else None
    except ValueError:
        account_limit = None

    while True:
        with count_lock:
            if account_limit is not None and created_count >= account_limit:
                break

        remaining = (
            account_limit - created_count
            if account_limit is not None
            else float("inf")
        )
        threads_in_batch = min(total_threads, int(remaining))

        if threads_in_batch <= 0:
            break

        threads = []
        for i in range(threads_in_batch):
            proxy = get_next_proxy(proxies)
            t = threading.Thread(
                target=run_thread,
                args=(
                    i,
                    prefix,
                    password,
                    password_length,
                    threads_in_batch,
                    account_limit,
                    proxy,
                ),
            )
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        with count_lock:
            if account_limit is not None and created_count >= account_limit:
                break

    print(f"\nda tao {created_count} tai khoan. mo acc.txt...")
    log_status(
        f"Chương trình kết thúc, đã tạo {created_count} tài khoản", DEFAULT_LOG_FILE
    )

    try:
        subprocess.Popen(["notepad", "acc.txt"])
    except Exception:
        log_status(f"Lỗi mở acc.txt: {str(traceback.format_exc())}", DEFAULT_LOG_FILE)
