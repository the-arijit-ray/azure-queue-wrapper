import {QueueServiceClient} from "@azure/storage-queue";
import cron from "node-cron"
import fs from 'fs';
import path from 'path';

const configPath = path.resolve(__dirname, 'aqw.config.json');
const rawConfig = fs.readFileSync(configPath, 'utf8');
const config = JSON.parse(rawConfig);

const queueServiceClient = QueueServiceClient.fromConnectionString(config.azureStorageConnectionString);
const retries = config.retries ?? 3;

class AzureQueueWrapper {
    constructor(connectionString) {
        this.queueServiceClient = QueueServiceClient.fromConnectionString(connectionString) ?? queueServiceClient;
        this.queueTasks = [];
    }

    addQueueTask(queueName, cronExpression, callback, maxRetries = retries, deadLetterQueueName = `${queueName}-poison`) {
        this.queueTasks.push({ queueName, cronExpression, callback, maxRetries, deadLetterQueueName });
    }

    startQueueTasks() {
        this.queueTasks.forEach((connectionString,{ queueName, cronExpression, callback, maxRetries, deadLetterQueueName= `${queueName}-poison` }) => {
            cron.schedule(cronExpression, async () => {
                const queueClient = this.queueServiceClient.getQueueClient(queueName);
                const messages = await queueClient.receiveMessages();
                for (const message of messages.receivedMessageItems) {
                    try {
                        await callback(message);
                        await queueClient.deleteMessage(message.messageId, message.popReceipt);
                    } catch (error) {
                        console.error('Error processing message:', error);
                        if (message.dequeueCount > maxRetries) {
                                const deadLetterQueueClient = queueServiceClient.getQueueClient(deadLetterQueueName);
                                await deadLetterQueueClient.sendMessage(message.messageText);
                                await queueClient.deleteMessage(message.messageId, message.popReceipt);
                        }
                    }
                }
            });
        });
    }

    async addMessageToQueue(queueName, message) {
        const queueClient = this.queueServiceClient.getQueueClient(queueName);
        await queueClient.sendMessage(JSON.stringify(message));
    }
}

function ProcessAzureQueueMessage(connectionString,options) {
    return function (target, key) {
        const { queue, timeInterval = [5, 'seconds'], maxRetries, deadLetterQueue } = options;
        if (!queue) {
            throw new Error(`Queue name is required for @ProcessAzureQueueMessage decorator`);
        }
        if (!connectionString) {
            throw new Error(`Connection string is required for @ProcessAzureQueueMessage decorator`);
        }
        const [value, unit] = timeInterval;
        const callback = target[key];
        if (typeof callback === 'function') {
            const cronExpression = convertTimeIntervalToCron(value, unit);
            const azureQueue = new AzureQueueWrapper(connectionString);
            azureQueue.addQueueTask(queue, cronExpression, callback, maxRetries, deadLetterQueue);
            azureQueue.startQueueTasks();
        } else {
            throw new Error(`@ProcessAzureQueueMessage decorator can only be applied to functions`);
        }
    };
}


function AddMessageToQueue(connectionString) {
    return function (target, key, descriptor) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (queueName, message, ...args) {
            if (!queueName) {
                throw new Error('Queue name is required for AddMessageToQueue decorator');
            }
            if (!connectionString) {
                throw new Error(`Connection string is required for @ProcessAzureQueueMessage decorator`);
            }
            try {
                const response = await originalMethod.apply(this, [queueName, message, ...args]);
                const azureQueue = new AzureQueueWrapper(connectionString);
                await azureQueue.addMessageToQueue(queueName, message)

                return { status: 'success', response };
            } catch (error) {
                return { status: 'fail', error: error.message };
            }
        };

        return descriptor;
    };
}

function convertTimeIntervalToCron(value, unit) {
    let cronExpression = '';
    switch (unit.toLowerCase()) {
        case 'seconds':
            cronExpression = `*/${value} * * * * *`;
            break;
        case 'minutes':
            cronExpression = `*/${value} * * * *`;
            break;
        case 'hours':
            cronExpression = `0 */${value} * * *`;
            break;
        case 'days':
            cronExpression = `0 0 */${value} * *`;
            break;
        case 'weeks':
            cronExpression = `0 0 0 */${value * 7} *`;
            break;
        default:
            throw new Error(`Unsupported time interval unit: ${unit}`);
    }
    return cronExpression;
}

module.exports = {
    ProcessAzureQueueMessage,
    AddMessageToQueue
};
