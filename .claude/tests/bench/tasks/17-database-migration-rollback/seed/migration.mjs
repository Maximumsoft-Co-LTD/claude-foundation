export function up(rows) {
  return rows.map((row) => ({
    id: row.id,
    displayName: row.name,
    status: row.disabled ? "disabled" : "active"
  }));
}

export function down(rows) {
  return rows.map((row) => ({ id: row.id, name: row.displayName, disabled: false }));
}
