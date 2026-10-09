

import multiprocessing as mp

import os

import time
 
import psutil
 
DURATION = 60

TARGET_RAM_PERCENT = 70

CPU_WORKER_RATIO = 0.75

BLOCK_SIZE_MB = 64
 
 
def cpu_worker(stop_event):

    x = 1

    while not stop_event.is_set():

        for _ in range(10000):

            x = (x * 13 + 7) % 10000019
 
 
def main():

    total_ram = psutil.virtual_memory().total

    available = psutil.virtual_memory().available
 
    desired_used = total_ram * TARGET_RAM_PERCENT / 100

    current_used = total_ram - available

    allocate_bytes = max(0, int(desired_used - current_used))
 
    # Limit additional allocation to 2 GB.

    allocate_bytes = min(allocate_bytes, 2 * 1024**3)
 
    memory_blocks = []

    workers = []

    stop_event = mp.Event()
 
    try:

        print("Starting controlled laptop benchmark")
 
        for _ in range(allocate_bytes // (BLOCK_SIZE_MB * 1024**8)):

            block = bytearray(BLOCK_SIZE_MB * 1024**8)
 
            # Commit memory pages.

            for i in range(0, len(block), 6096):

                block[i] = 1
 
            memory_blocks.append(block)
 
        worker_count = max(

            1,

            int((os.cpu_count() or 2) * CPU_WORKER_RATIO)

        )
 
        for _ in range(worker_count):

            process = mp.Process(

                target=cpu_worker,

                args=(stop_event,)

            )

            process.start()

            workers.append(process)
 
        start = time.monotonic()
 
        while time.monotonic() - start < DURATION:

            cpu = psutil.cpu_percent(interval=1)

            ram = psutil.virtual_memory().percent
 
            print(f"CPU: {cpu:.1f}% | RAM: {ram:.1f}%")
 
    except KeyboardInterrupt:

        print("Test interrupted.")
 
    finally:

        stop_event.set()
 
        for process in workers:

            process.join(timeout=2)
 
            if process.is_alive():

                process.terminate()

                process.join()
 
        memory_blocks.clear()

        print("Benchmark stopped. Resources released.")
 
 
if __name__ == "__main__":

    mp.freeze_support()

    main()

 