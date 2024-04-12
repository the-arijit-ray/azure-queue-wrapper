"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddMessageToQueue = exports.ProcessAzureQueueMessage = void 0;
const utils_1 = require("./utils/utils");
const { QueueClient, QueueServiceClient } = require("@azure/storage-queue");
const cron = require("node-cron");
const { QueueOptions, QueueTasks } = require("./types");
const { convertTimeIntervalToCron } = require("./utils/utils");
const retries = 3;
const interval = [5, "seconds"];
const leaseDuration = 60; //in seconds
const initialDelay = 60; //in seconds
class AzureQueueWrapper {
    constructor() {
        this.queueTasks = [];
        this.queueConnections = {};
        this.queueServiceConnections = {};
    }
    getQueueClient(connectionString, queueName) {
        if (!this.queueConnections[queueName]) {
            this.queueConnections[queueName] =
                this.getQueueServiceClient(connectionString).getQueueClient(queueName);
        }
        return this.queueConnections[queueName];
    }
    getQueueServiceClient(connectionString) {
        if (!this.queueServiceConnections[connectionString]) {
            this.queueServiceConnections[connectionString] =
                QueueServiceClient.fromConnectionString(connectionString);
        }
        return this.queueServiceConnections[connectionString];
    }
    addQueueTask(queueName, cronExpression, callback, maxRetries = retries, deadLetterQueueName = `${queueName}-poison`, numberOfMessages = 1, isMessageEncoded = false) {
        this.queueTasks.push({
            queueName,
            cronExpression,
            callback,
            maxRetries,
            deadLetterQueueName,
            numberOfMessages,
            isMessageEncoded,
        });
    }
    startQueueTasks(connectionString, delay) {
        setTimeout(() => {
            this.queueTasks.forEach(({ queueName, cronExpression, callback, maxRetries, deadLetterQueueName = `${queueName}-poison`, numberOfMessages = 1, isMessageEncoded = false, }) => {
                cron.schedule(cronExpression, () => __awaiter(this, void 0, void 0, function* () {
                    const queueClient = this.getQueueClient(connectionString, queueName);
                    const messages = yield queueClient.receiveMessages({
                        numberOfMessages,
                    });
                    for (const message of messages.receivedMessageItems) {
                        yield this.processMessage(queueClient, message, isMessageEncoded, maxRetries, connectionString, deadLetterQueueName, callback);
                    }
                }));
            });
        }, delay * 1000);
    }
    processMessage(queueClient, message, isMessageEncoded, maxRetries, connectionString, deadLetterQueueName, callback) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const intervalId = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                    yield queueClient.updateMessage(message.messageId, message.popReceipt, message.messageText, 240);
                }), leaseDuration * 1000);
                let finalMessage = (0, utils_1.getProcessedMessage)(message, isMessageEncoded);
                yield callback(finalMessage);
                yield this.removeMessageFromQueue(queueClient, message);
                clearInterval(intervalId);
            }
            catch (error) {
                yield this.handleProcessingError(error, message, maxRetries, connectionString, deadLetterQueueName, queueClient);
            }
        });
    }
    handleProcessingError(error, message, maxRetries, connectionString, deadLetterQueueName, queueClient) {
        return __awaiter(this, void 0, void 0, function* () {
            console.error("Error processing message: ", error);
            if (message.dequeueCount > maxRetries) {
                yield this.moveMessageToPoison(connectionString, deadLetterQueueName, message);
                yield this.removeMessageFromQueue(queueClient, message);
            }
            else {
                yield queueClient.updateMessage(message.messageId, message.popReceipt, message.messageText, 0);
            }
        });
    }
    addMessageToQueue(connectionString, queueName, message) {
        return __awaiter(this, void 0, void 0, function* () {
            const queueClient = this.getQueueClient(connectionString, queueName);
            try {
                const parsedMessage = JSON.parse(JSON.stringify(message));
                yield queueClient.sendMessage(JSON.stringify(parsedMessage));
            }
            catch (e) {
                yield queueClient.sendMessage(message);
            }
        });
    }
    removeMessageFromQueue(queueClient, message) {
        return __awaiter(this, void 0, void 0, function* () {
            yield queueClient.deleteMessage(message.messageId, message.popReceipt);
        });
    }
    moveMessageToPoison(connectionString, deadLetterQueueName, message) {
        return __awaiter(this, void 0, void 0, function* () {
            const deadLetterQueueClient = this.getQueueClient(connectionString, deadLetterQueueName);
            yield deadLetterQueueClient.sendMessage(message.messageText);
        });
    }
}
function ProcessAzureQueueMessage(connectionString, options) {
    return function (target, key) {
        const { queue, timeInterval = interval, maxRetries = retries, deadLetterQueue, numberOfMessages, isMessageEncoded, startupDelay } = options;
        if (!queue) {
            throw new Error(`Queue name is required for @ProcessAzureQueueMessage decorator`);
        }
        if (!connectionString) {
            throw new Error(`Connection string is required for @ProcessAzureQueueMessage decorator`);
        }
        const [value, unit] = timeInterval;
        const callback = target[key];
        if (typeof callback === "function") {
            const cronExpression = convertTimeIntervalToCron(value, unit);
            const azureQueue = new AzureQueueWrapper();
            azureQueue.addQueueTask(queue, cronExpression, callback, maxRetries, deadLetterQueue, numberOfMessages, isMessageEncoded);
            azureQueue.startQueueTasks(connectionString, startupDelay !== null && startupDelay !== void 0 ? startupDelay : initialDelay);
        }
        else {
            throw new Error(`@ProcessAzureQueueMessage decorator can only be applied to functions`);
        }
    };
}
exports.ProcessAzureQueueMessage = ProcessAzureQueueMessage;
function AddMessageToQueue(connectionString) {
    return function (target, key, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (queueName, message, ...args) {
            return __awaiter(this, void 0, void 0, function* () {
                if (!queueName) {
                    throw new Error("Queue name is required for AddMessageToQueue decorator");
                }
                if (!connectionString) {
                    throw new Error(`Connection string is required for @ProcessAzureQueueMessage decorator`);
                }
                try {
                    const response = yield originalMethod.apply(this, [
                        queueName,
                        message,
                        ...args,
                    ]);
                    const azureQueue = new AzureQueueWrapper();
                    yield azureQueue.addMessageToQueue(connectionString, queueName, message);
                    return { status: "success", response };
                }
                catch (error) {
                    return { status: "fail", error: error.message };
                }
            });
        };
        return descriptor;
    };
}
exports.AddMessageToQueue = AddMessageToQueue;
module.exports = {
    ProcessAzureQueueMessage,
    AddMessageToQueue,
};
//# sourceMappingURL=index.js.map