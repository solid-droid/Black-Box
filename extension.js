const vscode = require('vscode');
const fetch = require('node-fetch');
const env = require('./apiKeys');
/**
 * @param {vscode.ExtensionContext} context
 */

async function activate(context) {
	// openAITest();
	const list = await testGETdata();

	const $findDoc = vscode.commands.registerCommand('black-box.findDocs', 
	async  () => await dropdown(list));

	const $askQues = vscode.commands.registerCommand('black-box.askQuestion', 
	async  () => await askQuestion() );

	context.subscriptions.push($findDoc);
	context.subscriptions.push($askQues);
}

async function dropdown(list){
	const pick = await vscode.window.showQuickPick(list , {matchOnDetail: true});
	if(pick){
	vscode.window.showInformationMessage(`Hello ${pick.label}`);
	}
}

async function askQuestion(){
	const answer = await vscode.window.showInformationMessage(
		`How was your day` ,
		 "good",
		 "bad"
		);
	if(answer === "good"){
		vscode.window.showInformationMessage("Good");
	}else if(answer === "bad"){
		vscode.window.showInformationMessage("Bad");
	}else{
		vscode.window.showInformationMessage("No answer");
	}
}

async function openAITest(){
		const code = `
	let a = [1,2,3,4,5];
	a.sort((a,b) => a-b);
	console.log(a);`

	const descritption = await describeCode(code);
  	console.log(descritption?.choices[0]?.text);
}

async function describeCode(code){
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const OPENAI_API_KEY = env.OPENAI_API_KEY;
	const engine = 'davinci-codex';
	const url = `https://api.openai.com/v1/engines/${engine}/completions`;
	code = `
	${code}
	"""
	describe the above code:
	`;
	return await (await fetch(url,{
		headers: {
		  'Authorization': `Bearer ${OPENAI_API_KEY}`,
		  'Content-Type': 'application/json'
		},
		body:JSON.stringify(
		 {
				prompt: code,
				temperature: 0,
				max_tokens: 64,
				top_p: 1.0,
				frequency_penalty: 0.0,
				presence_penalty: 0.0,
				stop: ["\"\"\""]
		  }),
			  method: 'POST',
		})).json();
}

async function testGETdata(){
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const testdata = await (await fetch('http://jsonplaceholder.typicode.com/users')).json();
	return testdata.map(user => ({
		label: user.name,
		detail: user.username,
		data: user
	}));
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}
