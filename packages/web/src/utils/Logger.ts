import { formatDate } from "./FormatDate";

interface LogData {
  message: string;
  data?: unknown;
}

export class Logger {
  static info(log: LogData) {
    console.log(
      `[INFO] ${formatDate(new Date())} - ${log.message}`,
      log.data ? JSON.stringify(log.data, null, 2) : "",
    );
  }

  static error(log: LogData) {
    console.error(
      `[ERROR] ${formatDate(new Date())} - ${log.message}`,
      log.data ? JSON.stringify(log.data, null, 2) : "",
    );
  }

  static warning(log: LogData) {
    console.warn(
      `[WARNING] ${formatDate(new Date())} - ${log.message}`,
      log.data ? JSON.stringify(log.data, null, 2) : "",
    );
  }
}
