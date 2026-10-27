"""Small parameterized SQLite transport; business rules belong in JS."""
import json
import sqlite3
import sys

connection = sqlite3.connect(sys.argv[1], timeout=20)
connection.row_factory = sqlite3.Row
try:
    request = json.load(sys.stdin)
    connection.execute("BEGIN IMMEDIATE")
    output = []
    for statement in request:
        cursor = connection.execute(statement["sql"], statement.get("params", []))
        if "changes" in statement and cursor.rowcount != statement["changes"]:
            raise ValueError(statement.get("error", "CONFLICT"))
        output.append([dict(row) for row in cursor.fetchall()])
    connection.commit()
    print(json.dumps({"rows": output}))
except Exception as error:
    connection.rollback()
    print(json.dumps({"error": str(error)}))
finally:
    connection.close()
