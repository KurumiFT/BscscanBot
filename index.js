const Axios = require('axios')
const MongoClient = require('mongodb').MongoClient;
const TelegramBot = require('node-telegram-bot-api');

let bots, groups

const connection_string = "mongodb://super_user:It%26Company@38.180.29.106:27017/?authMechanism=DEFAULT&authSource=admin"
const mongoClient = new MongoClient(connection_string);

function addGroupTo(contract, group) {
    groups.findOne({
        contract: contract,
        group: group
    }).then((res) => {
        if (!res) {
            groups.insertOne({
                contract: contract,
                group: group,
                timestamp: Date.now()
            })
        }
    })
}

function removeGroupTo(contract, group) {
    groups.deleteOne({contract : contract, group: group})
}

function updateLastTimestamp(contract, timestamp) {
    bots.updateOne({
        contract: contract
    }, {
        "$set": {
            "last_timestamp": timestamp
        }
    })
}

function getGroups(contract) {
    return new Promise((resolve, reject) => {
        groups.find({
            contract: contract
        }).toArray().then(res => {
            resolve(res)
        })
    })

}

function getLastTimestamp(contract) {
    return new Promise((resolve, reject) => {
        bots.findOne({
            contract: contract
        }).then(res => {
            if (!res) { reject() }
            resolve(res.last_timestamp)
        }).catch(reject)
    })
}

const bot = async (token, api, contract, last_timestamp) => {
    const tg_bot = new TelegramBot(token, { polling: true });
    const id = (await tg_bot.getMe()).id

    tg_bot.on('new_chat_members', (event) => {
        if (event.new_chat_members.find(User => { return User.id == id })) {
            addGroupTo(contract, event.chat.id)
        }
    })

    tg_bot.on('left_chat_member', (event) => {
        if (event.left_chat_member.id == id) {
            removeGroupTo(contract, event.chat.id)
        }
    })

    setInterval(() => {
        check()
    }, 3000);

    function check() {
        getLastTimestamp(contract).then(timestamp => {
            Axios.get("https://api.bscscan.com/api?module=account&action=txlist", {
                params: {
                    address: contract,
                    startblock: 0,
                    endblock: 99999999,
                    sort: "asc",
                    apikey: api,
                }
            }).then(response => {
                const transactions = response.data.result
                const valid_transactions = []
                let new_timestamp = 0
                transactions.forEach(transaction => {
                    if (parseFloat(transaction.timeStamp) > timestamp & parseFloat(transaction.value) > 0) {
                        valid_transactions.push(transaction)
                        new_timestamp = Math.max(parseFloat(transaction.timeStamp), new_timestamp)
                    }
                })

                if (valid_transactions.length > 0) {
                    Axios.get("https://api.bscscan.com/api?module=account&action=balance", {
                        params: {
                            address: contract,
                            apikey: api
                        }
                    }).then(balance_response => {
                        const balance = parseInt(balance_response.data.result)
                        Axios.get("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT").then(usdt_res => {
                            last_timestamp = new_timestamp
                            updateLastTimestamp(contract, last_timestamp)

                            const info_contract = `❔ BNB Balance on contract: <code>${parseFloat(balance) / Math.pow(10, 18)} / ${(parseFloat(usdt_res.data.price) * parseFloat(balance) / Math.pow(10, 18)).toFixed(2)}$</code>`

                            const mapped_transactions = valid_transactions.map((transaction, index) => {
                                const transaction_value = parseFloat(transaction.value) / Math.pow(10, 18)
                                return `🤯 <i>Project #1</i>\n❗️ Catched new transaction!\n  Value: <code>${transaction_value} / ${(transaction_value * parseFloat(usdt_res.data.price)).toFixed(2)}$</code>\n  Txn Fee: <code>${(parseFloat(transaction.gasPrice) * parseFloat(transaction.gasUsed) / Math.pow(10, 18))}</code>`
                            })

                            getGroups(contract).then(tables => {
                                tables.forEach(table => {
                                    let i = 0

                                    function iter() {
                                        tg_bot.sendMessage(table.group, mapped_transactions[i] + "\n\n" + info_contract, {
                                            parse_mode: 'HTML'
                                        }).then(() => {
                                            i += 1
                                            if (i < mapped_transactions.length) {
                                                iter()
                                            }
                                        }).catch(console.error)
                                    }

                                    iter()
                                })
                            })
                        }).catch(console.error)
                    }).catch(console.error)
                }
            }).catch(console.error)
        })
    }
}

(async () => {
    await mongoClient.connect()

    const bscscan = mongoClient.db('bscscan')
    bots = bscscan.collection('bots')
    groups = bscscan.collection('groups')

    /**
     * @type {Map<String, boolean>}
     */
    const enabled_bots = {  }

    function check() {
        bots.find().toArray().then(bots => {
            bots.forEach(data => {
                if (!enabled_bots[data.token]) {
                    bot(data.token, data.api, data.contract, data.last_timestamp)
                    enabled_bots[data.token] = true        
                }
            })
        })
    }

    setInterval(() => {
        check()
    }, 5000);

    // bots.find().toArray().then(bots => {
    //     bots.forEach((data) => {
    //         bot(data.token, data.api, data.contract, data.last_timestamp)
    //         enabled_bots[data.token] = true
    //     })
    // })
})()

