import { getProcessedMessage } from "./utils/utils";

const { QueueClient, QueueServiceClient } = require("@azure/storage-queue");
const cron = require("node-cron");
const { QueueOptions, QueueTasks } = require("./types");
const { convertTimeIntervalToCron } = require("./utils/utils");
let messageCount = 0;
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

  /**
   * Adds a scheduled queue task configuration to the internal task list.
   * @example
   * ddQueueTask('my-queue', '0 * * * *', async (message) => { /* ... */
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

  /**
   * Starts scheduled queue polling tasks after a specified delay.
   * @example
   * tartQueueTasks(connectionString, delay)
   * undefined
   * @param {string} connectionString - The connection string used to create queue clients.
   * @param {number} delay - Delay in seconds before the queue tasks are started.
   * @returns {void} This function does not return a value.
   */
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
            if(messageCount < numberOfMessages) {
              const messages = await queueClient.receiveMessages({
              numberOfMessages : Number(numberOfMessages - messageCount),
                visibilityTimeout: 90
              });
              messageCount += messages.receivedMessageItems.length;
              const promises: Promise<void>[] = [];
              for (const message of messages.receivedMessageItems) {
                promises.push(this.processMessage(
                    queueClient,
                    message,
                    isMessageEncoded,
                    maxRetries,
                    connectionString,
                    deadLetterQueueName,
                    callback,
                ));
              }
              await Promise.all(promises);
              messageCount -= promises.length;
            }
          });
        },
      );
    }, delay * 1000);
  }

  /**
   * Processes a queue message by renewing its lease, decoding it if needed, invoking a callback, and removing it from the queue on success.
   * @example
   * processMessage(queueClient, message, true, maxRetries, connectionString, deadLetterQueueName, callback)
   * undefined
   * @param {typeof QueueClient} queueClient - The queue client used to update and remove the message.
   * @param {any} message - The queue message to process.
   * @param {boolean} isMessageEncoded - Indicates whether the message payload is encoded.
   * @param {number} maxRetries - The maximum number of retries allowed for processing errors.
   * @param {string} connectionString - The Azure Storage connection string used for error handling or dead-lettering.
   * @param {string} deadLetterQueueName - The name of the dead-letter queue.
   * @param {(message: any) => Promise<void>} callback - Async callback invoked with the processed message.
   * @returns {Promise<void>} A promise that resolves when processing completes or error handling finishes.
   */
  async processMessage(
    queueClient: typeof QueueClient,
    message: any,
    isMessageEncoded: boolean,
    maxRetries: number,
    connectionString: string,
    deadLetterQueueName: string,
    callback: (message: any) => Promise<void>,
  ) {
    let intervalId: any;
    try {
      intervalId = setInterval(async () => {
        try {
          const updatedMessageDetails = await queueClient.updateMessage(
            message.messageId,
            message.popReceipt,
            message.messageText,
            120,
          );

          //azure queue changes popReceipt after every update/get message operation.
          message.popReceipt = updatedMessageDetails.popReceipt;
        } catch (e: any) {
          if (e?.statusCode != 404) {
            throw e;
          }
          else {
            clearInterval(intervalId);
          }
        }
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

  /**
   * Handles errors that occur during message processing by either retrying the message or moving it to a poison queue.
   * @example
   * handleProcessingError(error, message, maxRetries, connectionString, deadLetterQueueName, queueClient)
   * undefined
   * @param {any} error - The error thrown while processing the message.
   * @param {any} message - The queue message being processed.
   * @param {number} maxRetries - The maximum number of retry attempts allowed before moving the message to the dead-letter queue.
   * @param {string} connectionString - The connection string used to access the queue service.
   * @param {string} deadLetterQueueName - The name of the dead-letter queue where failed messages are moved.
   * @param {typeof QueueClient} queueClient - The queue client used to update or remove the message.
   * @returns {Promise<void>} A promise that resolves when error handling completes.
   **/
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

  /**
  * Adds a message to the specified queue using the provided connection string and queue name.
  * @example
  * addMessageToQueue("UseDevelopmentStorage=true", "my-queue", { id: 1, text: "hello" })
  * undefined
  * @param {string} connectionString - The connection string used to create the queue client.
  * @param {string} queueName - The name of the queue to send the message to.
  * @param {any} message - The message payload to enqueue.
  * @returns {Promise<void>} Resolves when the message has been successfully sent to the queue.
  **/
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

/**
* Decorates a method to process messages from an Azure Queue on a scheduled interval, registering the method as a queue task and starting the queue processor with the provided connection settings.
* @example
* @ProcessAzureQueueMessage("UseDevelopmentStorage=true;", {
*   queue: "my-queue",
*   timeInterval: [5, "minutes"],
*   maxRetries: 3
* })
* async handleQueueMessage(message) {
*   return "processed";
* }
* @param {string} connectionString - Azure Storage connection string used to connect to the queue service.
* @param {typeof QueueOptions} options - Configuration options for the queue processor, including queue name, interval, retries, dead-letter queue, and other processing settings.
* @returns {(target: any, key: string, descriptor: PropertyDescriptor) => PropertyDescriptor | void} A method decorator that replaces the original function with a queue-processing wrapper or throws an error when configuration is invalid.
**/
export function ProcessAzureQueueMessage(
  connectionString: string,
  options: typeof QueueOptions,
): (target: any, key: string, descriptor: PropertyDescriptor) => PropertyDescriptor | void {
  return function (target: any, key: string, descriptor: PropertyDescriptor) {
    const {
      queue,
      timeInterval = interval,
      maxRetries = retries,
      deadLetterQueue,
      numberOfMessages,
      isMessageEncoded,
      startupDelay,
      disabled
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
    const callback = descriptor.value;
    if (typeof callback === "function") {
      if (disabled) {
        console.warn(`Messages from Azure queue named ${queue} will not be processed as the processor is disabled!`)
        return;
      }
      const cronExpression = convertTimeIntervalToCron(value, unit);
      descriptor.value = async function (...args: any[]) {

        //"this" refers to the instance of the class the callback is part of.
        const bindedCallback = callback.bind(this, ...args)

        const azureQueue = new AzureQueueWrapper();
        azureQueue.addQueueTask(
          queue,
          cronExpression,
          bindedCallback,
          maxRetries,
          deadLetterQueue,
          numberOfMessages,
          isMessageEncoded,
        );
        azureQueue.startQueueTasks(connectionString, startupDelay ?? initialDelay);
      }
      return descriptor;
    } else {
      throw new Error(
        `@ProcessAzureQueueMessage decorator can only be applied to functions`,
      );
    }
  };
}

/**
 * Creates a decorator that enqueues a message to an Azure queue after the decorated method executes successfully.
 * @example
 * AddMessageToQueue("UseDevelopmentStorage=true;")(target, "methodName", descriptor)
 * { status: "success", response: result }
 * @param {string} connectionString - Azure Storage connection string used to connect to the queue service.
 * @returns {(target: any, key: string, descriptor: PropertyDescriptor) => PropertyDescriptor | { status: string; error: any }} A method decorator that wraps the original method and returns a success or failure status object.
 */
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
