export async function saveBudget(PouchDB, openpgp, event, password) {
    event.preventDefault();
    const params = new URLSearchParams(document.location.search);
    const values = [...document.getElementsByTagName("input")].map(el => ({ id: el.id, value: parseFloat(el.value) })).filter(cat => cat.value !== 0);
    console.log(values)

    const budgetDB = new PouchDB("budgets");
    const budgetValues = await encryptText(openpgp, JSON.stringify(values), password);
    const budget = {
        "_id": params.get("budgetMonth"),
        "budget": budgetValues
    }
    budgetDB.put(budget);
}

export async function getCurrentBudget(PouchDB, openpgp, params, password) {
    const budgetDB = new PouchDB("budgets");
    const budgetMonth = params.get("budgetMonth");
    // There should only be one budget per month so use the first one
    const budget = (await budgetDB.allDocs({ include_docs: true, startkey: budgetMonth, endkey: `${budgetMonth}\ufff0` })).rows[0]?.doc.budget

    if (!budget) {
        console.log("Could not find document. Loading empty budget...")
        return [];
    }

    const decryptedBudget = await decryptText(openpgp, budget, password)
    return JSON.parse(decryptedBudget);
}

export async function getCategories(PouchDB, openpgp, params, password) {
    if (sessionStorage.getItem("decryptedCategories")) {
        return JSON.parse(sessionStorage.getItem("decryptedCategories"));
    }

    const categoriesDB = new PouchDB("categories");
    let categoryResults = await categoriesDB.allDocs({ include_docs: true });
    if (categoryResults.total_rows === 0) {
        await createNewCategoriesFromParams(PouchDB, openpgp, params, password);
        categoryResults = await categoriesDB.allDocs({ include_docs: true });
    }
    console.log(categoryResults);
    // const categoriesDB = new PouchDB("categories");
    // let categoryResults = await categoriesDB.allDocs({ include_docs: true });
    // console.log(categoryResults)
    // if (categoryResults.total_rows === 0) {
    //     await createNewCategoriesFromParams(PouchDB, openpgp, params, password);
    //     categoryResults = await categoriesDB.allDocs({ include_docs: true });
    //     console.log(categoryResults)
    //     setTimeout(async () => {
    //         console.log(await categoriesDB.allDocs({ include_docs: true }))
    //     }, 0);
    // }
    // if (!sessionStorage.getItem("decryptedCategories")) {
    //     console.log(categoryResults)
    //     categoryResults = await decryptAllDocs(openpgp, categoryResults.rows, password);
    //     sessionStorage.setItem("decryptedCategories", JSON.stringify(categoryResults.flatMap(c => c.doc)));
    // }
    // return JSON.parse(sessionStorage.getItem("decryptedCategories"));
}

export async function getTransactionsForCategory(PouchDB, openpgp, category, start, end, password) {
    const transactionsDB = new PouchDB("transactions");
    const transactions = (await transactionsDB.allDocs({ include_docs: true, startkey: start, endkey: end })).rows;
    if (transactions.length === 0) {
        return [];
    }
    const decryptedTransactions = await decryptAllDocs(openpgp, transactions, password);
    return JSON.parse(decryptedTransactions.flatMap(t => t.doc).filter(t => t.category === category));
}

export function getNextOrPreviousMonth(budgetMonth, next = true) {
    const increment = next ? 1 : -1;
    const date = new Date(`${budgetMonth}, 1 1970`);
    date.setMonth(date.getMonth() + increment);
    return `${date.toLocaleString("default", { month: "long" })}_${date.getFullYear()}`;
}

export async function decryptAllDocs(openpgp, rows, password) {
    const flatRows = rows.flatMap(r => r.doc)
    await Promise.all(flatRows.map(async d => await decryptDoc(openpgp, d, password)));
}

async function createNewCategoriesFromParams(PouchDB, openpgp, params, password) {
    const rawJSON = params.get("json");
    const json = JSON.parse(rawJSON);
    if (json.poisedBudgetVersion !== "0.0.1") {
        throw new Error("Poised Budget version does not match existing versions.")
    }

    const categoriesDB = new PouchDB("categories");
    console.log(await categoriesDB.allDocs({ include_docs: true }))
    const categories = json.categories;
    const docs = [];
    for (let c = 0; c < categories.length; c++) {
        const category = categories[c];
        const categroyName = await encryptText(openpgp, category.name, password);
        const categoryOrder = await encryptText(openpgp, JSON.stringify(category.order), password);
        const doc = {
            "_id": (new Date).toISOString(),
            "name": categroyName,
            "order": categoryOrder
        };

        docs.push(doc);

        for (let s = 0; s < category.sub_categories.length; s++) {
            const subCategory = category.sub_categories[s];
            const subCategoryName = await encryptText(openpgp, subCategory.name, password);
            const subCategoryOrder = await encryptText(openpgp, JSON.stringify(subCategory.order), password);
            const doc = {
                "_id": (new Date).toISOString(),
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

    console.log(await categoriesDB.allDocs({ include_docs: true }))
}

async function decryptDoc(openpgp, doc, password) {
    const keys = Object.keys(doc);
    const promises = keys.map(async (key) => {
        if (key === "_rev") {
            return;
        }
        const decrypted = await decryptText(openpgp, doc[key], password);
        doc[key] = decrypted;
    });

    await Promise.all(promises);
}

async function encryptText(openpgp, plaintext, password) {
    const message = await openpgp.createMessage({ text: plaintext });
    const encrypted = await openpgp.encrypt({ message, passwords: [password] });
    return encrypted;
}

async function decryptText(openpgp, ciphertext, password) {
    const message = await openpgp.readMessage({ armoredMessage: ciphertext });
    const { data, ...other } = await openpgp.decrypt({ message, passwords: [password] });
    return data
}
