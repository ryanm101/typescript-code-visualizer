import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import neo4j from 'neo4j-driver';
import yaml from 'js-yaml';

// Function to load Neo4j configuration from a YAML file
function loadConfig() {
    const configFile = fs.readFileSync('./config.yaml', 'utf8');
    return yaml.load(configFile) as any;
}

// Function to initialize the Neo4j driver
function createDriver(config: any) {
    return neo4j.driver(config.neo4j.uri, neo4j.auth.basic(config.neo4j.user, config.neo4j.password));
}

function sanitize(input: string): string {
    return input.replace(/[^a-zA-Z0-9_]/g, '_');
}

function visit(node: ts.Node, sourceFile: ts.SourceFile, callGraph: Map<string, Set<string>>, currentFunction: string | null = null) {
    if (ts.isFunctionDeclaration(node) && node.name) {
        currentFunction = node.name.getText(sourceFile); // New function scope
        if (!callGraph.has(currentFunction)) {
            callGraph.set(currentFunction, new Set());
        }
    }

    if (ts.isCallExpression(node) && currentFunction) {
        const callSignature = node.expression.getText(sourceFile);
        const sanitizedCallSignature = sanitize(callSignature);
        callGraph.get(currentFunction)!.add(sanitizedCallSignature);
    }

    ts.forEachChild(node, child => visit(child, sourceFile, callGraph, currentFunction));
}

function analyzeFile(filePath: string, callGraph: Map<string, Set<string>>) {
    const program = ts.createProgram([filePath], {});
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) return;

    ts.forEachChild(sourceFile, node => visit(node, sourceFile, callGraph));
}

function findTsFiles(dir: string, fileList: string[] = []) {
    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            fileList = findTsFiles(fullPath, fileList);
        } else if (fullPath.endsWith('.ts')) {
            fileList.push(fullPath);
        }
    });
    return fileList;
}

async function insertCallGraph(config: any, callGraph: Map<string, Set<string>>) {
    const driver = createDriver(config);
    const session = driver.session();

    try {
        for (const [caller, calls] of callGraph.entries()) {
            await session.run('MERGE (f:Function {name: $caller})', { caller });

            for (const called of calls) {
                await session.run(
                    'MATCH (caller:Function {name: $caller}) ' +
                    'MERGE (called:Function {name: $called}) ' +
                    'MERGE (caller)-[:CALLS]->(called)',
                    { caller, called: sanitize(called) }
                );
            }
        }
    } finally {
        await session.close();
        await driver.close();
    }
}

function generatePlantUML(callGraph: Map<string, Set<string>>, outputFilePath: string) {
    let plantUMLContent = "@startuml\n";
    callGraph.forEach((calls, caller) => {
        calls.forEach(called => {
            plantUMLContent += `"${caller}" --> "${called}": calls\n`;
        });
    });
    plantUMLContent += "@enduml";

    fs.writeFileSync(outputFilePath, plantUMLContent);
}

if (process.argv.length < 3) {
    console.log("Usage: node <script> <directoryPath>");
    process.exit(1);
}

if (process.argv.length < 3) {
    console.log("Usage: node <script> <directoryPath>");
    process.exit(1);
}


function main() {
    const directoryPath = process.argv[2];
    const config = loadConfig();

    const callGraph = new Map();
    const files = findTsFiles(directoryPath);
    files.forEach(file => analyzeFile(file, callGraph));

    if (config.neo4j.output) {
        insertCallGraph(config, callGraph).catch(console.error);
    }
    if (config.plantuml.output) {
        generatePlantUML(callGraph, config.plantuml.outputfile);
    }
}

main()
