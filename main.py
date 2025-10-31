from utils import VLCMThread
import threading
import traceback
import subprocess
import os
from pathlib import Path

write_lock = threading.Lock()
count_lock = threading.Lock()
proxy_lock = threading.Lock()
created_count = 0
proxy_index = 0


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

    except Exception:
        traceback.print_exc()
    finally:
        if thread:
            thread.close()


if __name__ == "__main__":
    update_title(0)
    proxies = load_proxies()

    prefix = input("prefix: ").strip()

    want_random_pass = input("random mk? (y/n): ").strip().lower()
    password = None
    password_length = 8
    if want_random_pass not in ("y", "yes"):
        password = input("nhap mk: ").strip() or None
    else:
        password_length_input = input("do dai mk (mac dinh 8): ").strip()
        if password_length_input:
            try:
                password_length = int(password_length_input)
                if password_length < 1:
                    password_length = 8
            except ValueError:
                password_length = 8

    try:
        total_threads = int(input("threads: ").strip())
    except ValueError:
        total_threads = 1

    account_limit_input = input("limit:").strip()
    account_limit = None
    if account_limit_input:
        try:
            account_limit = int(account_limit_input)
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
    try:
        subprocess.Popen(["notepad", "acc.txt"])
    except Exception:
        traceback.print_exc()

    print("nhan Enter de thoat...")
    input()
