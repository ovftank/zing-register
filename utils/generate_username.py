import json
import random
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MIN_USERNAME_LENGTH = 6
MAX_USERNAME_LENGTH = 24
UNAME_SUGGESTION_URL = "https://id.zing.vn/v2/uname-suggestion"


def get_random_username(username_prefix: str = "") -> str:
    if not username_prefix:
        length = random.randint(MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH)
        characters = "abcdefghijklmnopqrstuvwxyz0123456789"
        return "".join(random.choice(characters) for _ in range(length))

    remaining_length = MAX_USERNAME_LENGTH - len(username_prefix)
    min_suffix_length = max(2, MIN_USERNAME_LENGTH - len(username_prefix))
    suffix_length = random.randint(min_suffix_length, min(5, remaining_length - 1))

    characters = "abcdefghijklmnopqrstuvwxyz0123456789"
    suffix = "".join(random.choice(characters) for _ in range(suffix_length))
    return username_prefix + suffix


def generate_username(username_prefix: str, skip_usernames=None) -> str:
    if skip_usernames is None:
        skip_usernames = []

    if len(username_prefix) < MIN_USERNAME_LENGTH:
        username_prefix = ""

    username = get_random_username(username_prefix)
    is_username_available = False
    attempts = 0
    max_attempts = 50

    while (
        not is_username_available
        and len(username) >= MIN_USERNAME_LENGTH
        and len(username) < MAX_USERNAME_LENGTH
        and attempts < max_attempts
    ):
        attempts += 1

        if username in skip_usernames:
            username = get_random_username(username_prefix)
            continue

        try:
            params = {"username": username, "cb": "zmCore.js349140"}
            response = requests.get(UNAME_SUGGESTION_URL, params=params, timeout=10, verify=False)
            response.raise_for_status()

            response_text = response.text
            start_index = response_text.find("(")
            end_index = response_text.rfind(")")

            if start_index == -1 or end_index == -1:
                username = get_random_username(username_prefix)
                continue

            json_string = response_text[start_index + 1 : end_index]
            data = json.loads(json_string)

            if data.get("err") == "1":
                is_username_available = True
            else:
                username = get_random_username(username_prefix)
        except Exception:
            username = get_random_username(username_prefix)

    if not is_username_available:
        raise ValueError("Could not find an available username.")

    return username
