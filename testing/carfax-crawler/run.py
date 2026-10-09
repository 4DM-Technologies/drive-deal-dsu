import asyncio
import sys

from crawler import main


if __name__ == "__main__":

    if len(sys.argv) < 2:

        print(
            "Usage:\n"
            "python run.py <CARFAX_URL>"
        )

        sys.exit(1)

    url = sys.argv[1]

    asyncio.run(
        main(url)
    )