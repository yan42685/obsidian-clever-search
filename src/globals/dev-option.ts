// BUG: can't import { isDevEnvironment } from my-lib, I don't know why, 
//      it will be undefined and report an error
// import { isDevEnvironment } from "src/utils/my-lib";

const isDev =  process.env.NODE_ENV === "development";
export const devOption = {
    traceLog: isDev ? false : false,
    loadIndexFromDatabase: isDev ? true : true,
}