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

const config = loadConfig();

// Function to initialize the Neo4j driver
function createDriver() {
    return neo4j.driver(config.neo4j.uri, neo4j.auth.basic(config.neo4j.user, config.neo4j.password));
}

function sanitizeForNeo4j(input: string): string {
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
        callGraph.get(currentFunction)!.add(callSignature);
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

async function insertCallGraph(callGraph: Map<string, Set<string>>) {
    const driver = createDriver();
    const session = driver.session();

    try {
        for (const [caller, calls] of callGraph.entries()) {
            await session.run('MERGE (f:Function {name: $caller})', { caller });

            for (const called of calls) {
                await session.run(
                    'MATCH (caller:Function {name: $caller}) ' +
                    'MERGE (called:Function {name: $called}) ' +
                    'MERGE (caller)-[:CALLS]->(called)',
                    { caller, called: sanitizeForNeo4j(called) }
                );
            }
        }
    } finally {
        await session.close();
        await driver.close();
    }
}

if (process.argv.length < 3) {
    console.log("Usage: node <script> <directoryPath>");
    process.exit(1);
}

const directoryPath = process.argv[2];
const callGraph = new Map();
const files = findTsFiles(directoryPath);
files.forEach(file => analyzeFile(file, callGraph));
insertCallGraph(callGraph).catch(console.error);
