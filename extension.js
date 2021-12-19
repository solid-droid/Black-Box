const vscode = require('vscode');
const fetch = require('node-fetch');
const env = require('./apiKeys');
/**
 * @param {vscode.ExtensionContext} context
 */

async function activate(context) {

	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	const OPENAI_API_KEY = env.OPENAI_API_KEY;

	const engine = 'davinci-codex';
	  const url = `https://api.openai.com/v1/engines/${engine}/completions`;
  
  const data = await (await fetch(url,{
	headers: {
	  'Authorization': `Bearer ${OPENAI_API_KEY}`,
	  'Content-Type': 'application/json'
	},
	body:JSON.stringify(
	 {
			prompt: 
		`users.sort(function(a, b){
			  if(a.firstname < b.firstname) { return -1; }
			  if(a.firstname > b.firstname) { return 1; }
			  return 0;
			})
		"""
		Here's what the above code and function are doing:
		`,
			temperature: 0,
			max_tokens: 64,
			top_p: 1.0,
			frequency_penalty: 0.0,
			presence_penalty: 0.0,
			stop: ["\"\"\""]
	  }),
		  method: 'POST',
	})).json();
  
	console.log(data);
	
	const testdata = await (await fetch('http://jsonplaceholder.typicode.com/users')).json();
	const list = testdata.map(user => ({
		label: user.name,
		detail: user.username,
		data: user
	}));

	let disposable = vscode.commands.registerCommand(
		'black-box.findDocs', async  () => {
		// vscode.window.showInformationMessage('Hello World from Black Box!');
		const pick = await vscode.window.showQuickPick(list , {matchOnDetail: true});
		if(pick){
			vscode.window.showInformationMessage(`Hello ${pick.label}`);
		}
	});

	context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}
