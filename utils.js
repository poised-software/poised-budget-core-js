import PouchDB from 'pouchdb'
import openpgp from 'openpgp'

async function saveBudget(event, password) {
    event.preventDefault();
    const params = new URLSearchParams(document.location.search);
    const values = [...document.getElementsByTagName("input")].map(el => ({ id: el.id, value: parseFloat(el.value) })).filter(cat => cat.value !== 0);
    console.log(values)

    const budgetDB = new PouchDB("budgets");
    const _id = await encryptText(params.get("budgetMonth"), password);
    const month = await encryptText(params.get("budgetMonth").slice('_')[0], password);
    const budgetValues = await encryptText(JSON.stringify(values), password);
    const budget = {
        "_id": _id,
        "month": month,
        "budget": budgetValues
    }
    budgetDB.put(budget);
}

async function createNewCategoriesFromParams(params, password) {
    const rawJSON = params.get("json");
    const json = JSON.parse(rawJSON);
    if (json.poisedBudgetVersion !== "0.0.1") {
        throw new Error("Poised Budget version does not match existing versions.")
    }

    const categoriesDB = new PouchDB("categories");
    const categories = json.categories;
    const docs = [];
    for (let c = 0; c < categories.length; c++) {
        const category = categories[c];
        const categroyName = await encryptText(category.name, password);
        const categoryOrder = await encryptText(JSON.stringify(category.order), password);
        const doc = {
            "_id": categroyName,
            "name": categroyName,
            "order": categoryOrder
        };

        docs.push(doc);

        for (let s = 0; s < category.sub_categories.length; s++) {
            const subCategory = category.sub_categories[s];
            const subCategoryName = await encryptText(subCategory.name, password);
            const subCategoryOrder = await encryptText(JSON.stringify(subCategory.order), password);
            const doc = {
                "_id": subCategoryName,
                "name": subCategoryName,
                "order": subCategoryOrder,
                "category": categroyName
            }

            docs.push(doc);
        }
    }

    const createResult = await categoriesDB.bulkDocs(docs);
    // An array indicating responses either [true], [true, undefined], or [undefined]
    const resultSet = [...new Set(createResult.flatMap((res) => res.ok))];
    if (resultSet.includes(undefined)) {
        throw new Error("Failed to save categories to DB.");
    }
}

async function getCurrentBudget(params, password) {
    const budgetDB = new PouchDB("budgets");
    const budgetID = await findAssociatedCipher(budgetDB, params.get("budgetMonth"), password);

    if (!budgetID) {
        console.log("Could not find document. Loading empty budget...")
        return [];
    }

    const encryptedBlob = await budgetDB.get(budgetID);
    const decryptedBudget = await decryptText(encryptedBlob.budget, password)
    return JSON.parse(decryptedBudget);
}

async function getCategories(params, password) {
    const categoriesDB = new PouchDB("categories");
    let categoryResults = await categoriesDB.allDocs({ include_docs: true });
    if (categoryResults.total_rows === 0) {
        createNewCategoriesFromParams(params, password);
        categoryResults = await categoriesDB.allDocs({ include_docs: true });
    }
    if (!sessionStorage.getItem("decryptedCategories")) {
        await decryptAllDocs(categoryResults.rows, password);
        sessionStorage.setItem("decryptedCategories", JSON.stringify(categoryResults.rows.flatMap(c => c.doc)));
    }
    return JSON.parse(sessionStorage.getItem("decryptedCategories"));
}

// This is necessary because, unlike a hash, different ciphers are generated
// by openpgp.js for the same text. This makes it more secure, but it also increases complexity.
// Returns empty string if there is no associated cipher.
async function findAssociatedCipher(db, plaintext, password) {
    const all = await db.allDocs();
    // Returns array like: [{ cipher: "PGP989778", plaintext: "January_2025" }, { cipher: "PGP789783", plaintext: "February_2025" }]
    const associatedCiphers = await Promise.all(all.rows.map(async (r) => ({ cipher: r.id, plaintext: await decryptText(r.id, password) })));
    // There should be only one cipher per plaintext
    return associatedCiphers.filter((p) => p.plaintext === plaintext)[0]?.cipher || "";
}

async function decryptAllDocs(rows, password) {
    const flatRows = rows.flatMap(r => r.doc)
    await Promise.all(flatRows.map(async d => await decryptDoc(d, password)));
}

async function decryptDoc(doc, password) {
    const keys = Object.keys(doc);
    const promises = keys.map(async (key) => {
        if (key === "_rev") {
            return;
        }
        const decrypted = await decryptText(doc[key], password);
        doc[key] = decrypted;
    });

    await Promise.all(promises);
}

async function encryptText(plaintext, password) {
    const message = await openpgp.createMessage({ text: plaintext });
    const encrypted = await openpgp.encrypt({ message, passwords: [password] });
    return encrypted;
}

async function decryptText(ciphertext, password) {
    const message = await openpgp.readMessage({ armoredMessage: ciphertext });
    const { data, ...other } = await openpgp.decrypt({ message, passwords: [password] });
    return data
}

export { saveBudget, createNewCategoriesFromParams, getCurrentBudget, getCategories, decryptAllDocs }