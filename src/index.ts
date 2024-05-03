import { getProcessedMessage } from "./utils/utils";

const { QueueClient, QueueServiceClient } = require("@azure/storage-queue");
const cron = require("node-cron");
const { QueueOptions, QueueTasks } = require("./types");
const { convertTimeIntervalToCron } = require("./utils/utils");

const retries = 3;
const interval: [number, string] = [5, "seconds"];
const leaseDuration = 60; //in seconds
const initialDelay = 60; //in seconds

class AzureQueueWrapper {
  private queueTasks: typeof QueueTasks[];
  private queueConnections: { [key: string]: typeof QueueClient };
  private queueServiceConnections: { [key: string]: typeof QueueServiceClient };

  constructor() {
    this.queueTasks = [];
    this.queueConnections = {};
    this.queueServiceConnections = {};
  }

  private getQueueClient(
    connectionString: string,
    queueName: string,
  ): typeof QueueClient {
    if (!this.queueConnections[queueName]) {
      this.queueConnections[queueName] =
        this.getQueueServiceClient(connectionString).getQueueClient(queueName);
    }
    return this.queueConnections[queueName];
  }
  private getQueueServiceClient(
    connectionString: string,
  ): typeof QueueServiceClient {
    if (!this.queueServiceConnections[connectionString]) {
      this.queueServiceConnections[connectionString] =
        QueueServiceClient.fromConnectionString(connectionString);
    }
    return this.queueServiceConnections[connectionString];
  }

  addQueueTask(
    queueName: string,
    cronExpression: string,
    callback: (message: any) => Promise<void>,
    maxRetries = retries,
    deadLetterQueueName = `${queueName}-poison`,
    numberOfMessages = 1,
    isMessageEncoded = false,
  ) {
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

  startQueueTasks(connectionString: string, delay: number) {
    setTimeout(() => {
      this.queueTasks.forEach(
        ({
          queueName,
          cronExpression,
          callback,
          maxRetries,
          deadLetterQueueName = `${queueName}-poison`,
          numberOfMessages = 1,
          isMessageEncoded = false,
        }: typeof QueueTasks) => {
          cron.schedule(cronExpression, async () => {
            const queueClient = this.getQueueClient(
              connectionString,
              queueName,
            );
            const messages = await queueClient.receiveMessages({
              numberOfMessages,
              visibilityTimeout: 90
            });
            for (const message of messages.receivedMessageItems) {
              await this.processMessage(
                queueClient,
                message,
                isMessageEncoded,
                maxRetries,
                connectionString,
                deadLetterQueueName,
                callback,
              );
            }
          });
        },
      );
    }, delay * 1000);
  }

  async processMessage(
    queueClient: typeof QueueClient,
    message: any,
    isMessageEncoded: boolean,
    maxRetries: number,
    connectionString: string,
    deadLetterQueueName: string,
    callback: (message: any) => Promise<void>,
  ) {
    try {
      const intervalId = setInterval(async () => {
        const updatedMessageDetails = await queueClient.updateMessage(
          message.messageId,
          message.popReceipt,
          message.messageText,
          120,
        );

        //azure queue changes popReceipt after every update/get message operation.
        message.popReceipt = updatedMessageDetails.popReceipt;
      }, leaseDuration * 1000);
      let finalMessage = getProcessedMessage(message, isMessageEncoded);
      await callback(finalMessage);
      clearInterval(intervalId);
      await this.removeMessageFromQueue(queueClient, message);
    } catch (error) {
      await this.handleProcessingError(
        error,
        message,
        maxRetries,
        connectionString,
        deadLetterQueueName,
        queueClient,
      );
    }
  }

  async handleProcessingError(
    error: any,
    message: any,
    maxRetries: number,
    connectionString: string,
    deadLetterQueueName: string,
    queueClient: typeof QueueClient,
  ) {
    try {
      console.error("Error processing message: ", error);
      if (message.dequeueCount > maxRetries) {
        await this.moveMessageToPoison(
            connectionString,
            deadLetterQueueName,
            message,
        );
        await this.removeMessageFromQueue(queueClient, message);
      } else {
        await queueClient.updateMessage(
            message.messageId,
            message.popReceipt,
            message.messageText,
            0,
        );
      }
    } catch (e) {
      console.error(e);
    }
  }

  async addMessageToQueue(
    connectionString: string,
    queueName: string,
    message: any,
  ) {
    const queueClient = this.getQueueClient(connectionString, queueName);
    try {
      const parsedMessage = JSON.parse(JSON.stringify(message));
      await queueClient.sendMessage(JSON.stringify(parsedMessage));
    } catch (e) {
      await queueClient.sendMessage(message);
    }
  }

  async removeMessageFromQueue(queueClient: typeof QueueClient, message: any) {
    await queueClient.deleteMessage(message.messageId, message.popReceipt);
  }

  async moveMessageToPoison(
    connectionString: string,
    deadLetterQueueName: string,
    message: any,
  ) {
    const deadLetterQueueClient = this.getQueueClient(
      connectionString,
      deadLetterQueueName,
    );
    await deadLetterQueueClient.sendMessage(message.messageText);
  }
}

export function ProcessAzureQueueMessage(
  connectionString: string,
  options: typeof QueueOptions,
): (target: any, key: string) => void {
  return function (target: any, key: string) {
    const {
      queue,
      timeInterval = interval,
      maxRetries = retries,
      deadLetterQueue,
      numberOfMessages,
      isMessageEncoded,
      startupDelay
    } = options;
    if (!queue) {
      throw new Error(
        `Queue name is required for @ProcessAzureQueueMessage decorator`,
      );
    }
    if (!connectionString) {
      throw new Error(
        `Connection string is required for @ProcessAzureQueueMessage decorator`,
      );
    }
    const [value, unit] = timeInterval;
    const callback = target[key];
    if (typeof callback === "function") {
      const cronExpression = convertTimeIntervalToCron(value, unit);
      const azureQueue = new AzureQueueWrapper();
      azureQueue.addQueueTask(
        queue,
        cronExpression,
        callback,
        maxRetries,
        deadLetterQueue,
        numberOfMessages,
        isMessageEncoded,
      );
      azureQueue.startQueueTasks(connectionString,startupDelay ?? initialDelay);
    } else {
      throw new Error(
        `@ProcessAzureQueueMessage decorator can only be applied to functions`,
      );
    }
  };
}

export function AddMessageToQueue(
  connectionString: string,
): (
  target: any,
  key: string,
  descriptor: PropertyDescriptor,
) => PropertyDescriptor | { status: string; error: any } {
  return function (target: any, key: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (
      queueName: string,
      message: any,
      ...args: any[]
    ) {
      if (!queueName) {
        throw new Error(
          "Queue name is required for AddMessageToQueue decorator",
        );
      }
      if (!connectionString) {
        throw new Error(
          `Connection string is required for @ProcessAzureQueueMessage decorator`,
        );
      }

      try {
        const response = await originalMethod.apply(this, [
          queueName,
          message,
          ...args,
        ]);
        const azureQueue = new AzureQueueWrapper();

        await azureQueue.addMessageToQueue(
          connectionString,
          queueName,
          message,
        );

        return { status: "success", response };
      } catch (error: any) {
        return { status: "fail", error: error.message };
      }
    };

    return descriptor;
  };
}

module.exports = {
  ProcessAzureQueueMessage,
  AddMessageToQueue,
};
