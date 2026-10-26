# Example sheets

Two files to hand to whoever is filling in the catalogue or the food library:

| File | Goes into | Matched by |
|---|---|---|
| `vokve-products-example.xlsx` | Admin panel → **Catalogue** → Import a sheet | the `ID` column, or a slug made from the name |
| `vokve-meals-example.xlsx` | Admin panel → **Food library** → Import a sheet | the food's name |

Each workbook has two tabs: the sheet itself, with five rows filled in to
type over, and **How to fill this in** — one row per column saying whether it
is needed, what it means, and what the importer will refuse. The needed
columns are *Name, Price, Category* for products and *Name, Calories* for
meals; everything else may be left blank. `.csv` works as well as `.xlsx`.

## These are a snapshot

The panel builds the same files on request, from the same column lists the
importers read (`/api/example-sheets/products`, `/api/example-sheets/meals`,
each dialog's "Download the example sheet"). **That download is the one to
send people to** — it cannot be out of step with what the importer accepts,
and these two can, the first time a column is added.

Re-write them from the CRM after a column changes:

```sh
cd vokve-crm && npm run examples        # → ../docs/examples
```

## Before importing

Press **Check the sheet** first. It reads the file, maps the columns and asks
the API what it *would* do without writing anything — every row it cannot
read comes back with its line number and the reason. For products, the shelf
named in a row has to exist already (Shelves & subcategories), and prices are
in rupees.
