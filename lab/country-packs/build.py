"""Build a deterministic country seed pack from WDC's 2023 Product statistics ZIP."""
import argparse
import ast
import csv
import gzip
import io
import json
from pathlib import Path
import re
import zipfile


def collect(archive, country):
    # WDC's GB storefronts use .uk. The requested market remains GB in the pack.
    suffix = "." + {"GB": "uk"}.get(country, country.lower())
    hosts = set()
    for subset in ("top100", "minimum3"):
        member = f"table_statistics/Product_October2023_statistics_{subset}.csv"
        with archive.open(member) as stream:
            rows = csv.DictReader(io.TextIOWrapper(stream, encoding="utf-8-sig", newline=""))
            required = {"host", "number_of_rows", "column_name_and_density"}
            if not required.issubset(rows.fieldnames or []):
                raise ValueError(f"{member} is missing WDC table statistics columns")
            for row in rows:
                host = row["host"].lower().rstrip(".")
                if not host.endswith(suffix) or int(row["number_of_rows"]) < 10:
                    continue
                if len(host) > 253 or not all(
                    re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                    for label in host.split(".")
                ):
                    continue
                # WDC writes a Python literal dictionary of integer percentages in a CSV field.
                density = ast.literal_eval(row["column_name_and_density"]).get("offers", 0)
                if type(density) is not int or not 0 <= density <= 100:
                    raise ValueError(f"Invalid offers density at {member}:{rows.line_num}")
                if density >= 50:
                    hosts.add(host)
    return {"version": 1, "country": country, "corpus": "WDC Product 2023", "hosts": sorted(hosts)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("country", help="two-letter country code, e.g. CA, DE or GB")
    parser.add_argument("output", type=Path, help="new .json.gz file")
    args = parser.parse_args()
    country = args.country.upper()
    if not re.fullmatch("[A-Z]{2}", country):
        parser.error("country must have two ASCII letters")
    with zipfile.ZipFile(args.archive) as archive:
        pack = collect(archive, country)
    encoded = json.dumps(pack, separators=(",", ":")).encode("utf-8")
    with args.output.open("xb") as output:
        with gzip.GzipFile(fileobj=output, filename="", mode="wb", mtime=0) as stream:
            stream.write(encoded)
    print(f"{country}: {len(pack['hosts'])} distinct hosts")


if __name__ == "__main__":
    main()
