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

    if len(username_prefix) >= MAX_USERNAME_LENGTH:
        return username_prefix[:MAX_USERNAME_LENGTH]

    remaining_length = MAX_USERNAME_LENGTH - len(username_prefix)
    min_suffix_length = max(2, MIN_USERNAME_LENGTH - len(username_prefix))
    max_suffix_length = min(5, remaining_length - 1)

    if min_suffix_length > max_suffix_length:
        return username_prefix[:MAX_USERNAME_LENGTH]

    suffix_length = random.randint(min_suffix_length, max_suffix_length)

    characters = "abcdefghijklmnopqrstuvwxyz0123456789"
    suffix = "".join(random.choice(characters) for _ in range(suffix_length))
    return username_prefix + suffix


def _normalize_prefix(username_prefix: str) -> str:
    characters = "abcdefghijklmnopqrstuvwxyz0123456789"

    if len(username_prefix) < MIN_USERNAME_LENGTH:
        needed = MIN_USERNAME_LENGTH - len(username_prefix)
        suffix = "".join(random.choice(characters) for _ in range(needed))
        username_prefix = username_prefix + suffix

    if len(username_prefix) > MAX_USERNAME_LENGTH:
        username_prefix = username_prefix[:MAX_USERNAME_LENGTH]

    return username_prefix


def _check_username_availability(username: str) -> tuple[bool, bool]:
    try:
        params = {"username": username, "cb": "zmCore.js349140"}
        response = requests.get(
            UNAME_SUGGESTION_URL, params=params, timeout=10, verify=False
        )
        response.raise_for_status()

        response_text = response.text
        start_index = response_text.find("(")
        end_index = response_text.rfind(")")

        if start_index == -1 or end_index == -1:
            return False, True

        json_string = response_text[start_index + 1 : end_index]
        data = json.loads(json_string)

        is_available = data.get("err") == "1"
        return is_available, not is_available
    except Exception:
        return False, True


def generate_username(username_prefix: str, skip_usernames=None) -> str:
    if skip_usernames is None:
        skip_usernames = []

    characters = "abcdefghijklmnopqrstuvwxyz0123456789"
    current_prefix = _normalize_prefix(username_prefix)
    is_username_available = False
    attempts = 0
    max_attempts = 50
    username = None

    while (
        not is_username_available
        and len(current_prefix) >= MIN_USERNAME_LENGTH
        and len(current_prefix) <= MAX_USERNAME_LENGTH
        and attempts < max_attempts
    ):
        attempts += 1
        username = get_random_username(current_prefix)

        if username in skip_usernames:
            if len(current_prefix) < MAX_USERNAME_LENGTH:
                current_prefix += random.choice(characters)
            continue

        is_available, should_extend = _check_username_availability(username)

        if is_available:
            is_username_available = True
        elif should_extend and len(current_prefix) < MAX_USERNAME_LENGTH:
            current_prefix += random.choice(characters)

    if not is_username_available or username is None:
        raise ValueError("Could not find an available username.")

    return username
