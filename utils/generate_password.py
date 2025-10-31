import random
import string

DEFAULT_PASSWORD_LENGTH = 8


def generate_password(length: int = DEFAULT_PASSWORD_LENGTH) -> str:
    characters = string.ascii_letters + string.digits
    return "".join(random.choice(characters) for _ in range(length))
