import {QueueClient, QueueServiceClient} from "@azure/storage-queue";
import cron from "node-cron";
import {QueueOptions, QueueTasks} from "./types";

const retries = 3;
const interval: [number, string] = [5, 'seconds'];

class AzureQueueWrapper {
    private queueTasks: QueueTasks[];
    private queueConnections: { [key: string]: QueueClient };
    private queueServiceConnections: { [key: string]: QueueServiceClient }

    constructor() {
        this.queueTasks = [];
        this.queueConnections = {};
        this.queueServiceConnections = {};
    }

    private getQueueClient(connectionString: string, queueName: string): QueueClient {
        if (!this.queueConnections[queueName]) {
            this.queueConnections[queueName] = this.getQueueServiceClient(connectionString).getQueueClient(queueName);
        }
        return this.queueConnections[queueName];
    }
    private getQueueServiceClient(connectionString: string): QueueServiceClient {
        if (!this.queueServiceConnections[connectionString]) {
            this.queueServiceConnections[connectionString] = QueueServiceClient.fromConnectionString(connectionString);
        }
        return this.queueServiceConnections[connectionString];
    }

    addQueueTask(queueName: string, cronExpression: string, callback: (message: any) => Promise<void>, maxRetries = retries, deadLetterQueueName = `${queueName}-poison`) {
        this.queueTasks.push({ queueName, cronExpression, callback, maxRetries, deadLetterQueueName });
    }

    startQueueTasks(connectionString) {
        this.queueTasks.forEach(({ queueName, cronExpression, callback, maxRetries, deadLetterQueueName = `${queueName}-poison` }) => {
            cron.schedule(cronExpression, async () => {
                const queueClient = this.getQueueClient(connectionString, queueName);
                const messages = await queueClient.receiveMessages();
                for (const message of messages.receivedMessageItems) {
                    try {
                        await callback(message);
                        await queueClient.deleteMessage(message.messageId, message.popReceipt);
                    } catch (error) {
                        console.error('Error processing message: ', error);
                        if (message.dequeueCount > maxRetries) {
                            const deadLetterQueueClient = this.getQueueClient(connectionString, deadLetterQueueName);
                            await deadLetterQueueClient.sendMessage(message.messageText);
                            await queueClient.deleteMessage(message.messageId, message.popReceipt);
                        }
                    }
                }
            });
        });
    }

    async addMessageToQueue(connectionString: string,queueName: string, message: any) {
        const queueClient = this.getQueueClient(connectionString, queueName);
        await queueClient.sendMessage(JSON.stringify(message));
    }
}

function ProcessAzureQueueMessage(connectionString: string, options: QueueOptions) {
    return function (target: any, key: string) {
        const { queue, timeInterval = interval, maxRetries = retries, deadLetterQueue } = options;
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
            const azureQueue = new AzureQueueWrapper();
            azureQueue.addQueueTask(queue, cronExpression, callback, maxRetries, deadLetterQueue);
            azureQueue.startQueueTasks(connectionString);
        } else {
            throw new Error(`@ProcessAzureQueueMessage decorator can only be applied to functions`);
        }
    };
}

function AddMessageToQueue(connectionString: string) {
    return function (target: any, key: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (queueName: string, message: any, ...args: any[]) {
            if (!queueName) {
                throw new Error('Queue name is required for AddMessageToQueue decorator');
            }
            if (!connectionString) {
                throw new Error(`Connection string is required for @ProcessAzureQueueMessage decorator`);
            }

            try {
                const response = await originalMethod.apply(this, [queueName, message, ...args]);
                const azureQueue = new AzureQueueWrapper();

                await azureQueue.addMessageToQueue(connectionString, queueName, message)

                return { status: 'success', response };
            } catch (error) {
                return { status: 'fail', error: error.message };
            }
        };

        return descriptor;
    };
}

export { ProcessAzureQueueMessage, AddMessageToQueue };
