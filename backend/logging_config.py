import logging


def setup_logging():
    """Plain stdout logging; Docker / journalctl adds timestamps and capture."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
