import { isDevEnvironment } from "src/utils/my-lib";

export const devOption = {
    traceLog: isDevEnvironment ? false : false,
    loadIndexFromDatabase: isDevEnvironment ? false : true,
}