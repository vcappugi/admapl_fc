import time

start = time.time()
in_quotes = False
buffer = []
total_records = 0
field_mismatches = 0

with open('movimientos.csv', 'rb') as fin, open('movimientos_clean.csv', 'wb') as fout:
    for line in fin:
        # If not inside a quote, the line will end with many semicolons
        if not in_quotes:
            # Strip \r\n and trailing semicolons
            stripped = line.rstrip(b'\r\n')
            # Count quotes to see if an open quote exists
            quote_count = stripped.count(b'"')
            if quote_count % 2 == 1:
                # Open quote
                in_quotes = True
                buffer.append(stripped)
            else:
                # Complete line
                # Strip trailing semicolons beyond 20 delimiters
                # A row has 21 columns -> 20 semicolons
                # Let's strip trailing semicolons
                clean = stripped.rstrip(b';')
                fout.write(clean + b'\n')
                total_records += 1
        else:
            # Inside quote
            stripped = line.rstrip(b'\r\n')
            quote_count = stripped.count(b'"')
            buffer.append(stripped)
            if quote_count % 2 == 1:
                # Quote closed!
                in_quotes = False
                # Join buffer with space
                combined = b' '.join(buffer)
                buffer = []
                clean = combined.rstrip(b';')
                fout.write(clean + b'\n')
                total_records += 1

print(f'Done in {time.time() - start:.2f}s! Total records written: {total_records}')
