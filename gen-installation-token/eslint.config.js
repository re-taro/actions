import { re_taro } from "@re-taro/eslint-config";

export default re_taro({
	typescript: true,
	formatters: true,
	ignores: ["lib/*.cjs"],
});
