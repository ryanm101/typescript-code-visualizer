# typescript-code-visualizer

Creates a call map in neo4j allowing visualisation of which functions call others. 

## Usage 

* Install neo4j `brew install neo4j`
* Start Neo4J `neo4j start`
* Login to neo and set password to `neo4j123`:
* Execute applicion `tsc && node dist/analyzeDirectory.js <PATHtoSRC>`
* View in Neo4J UI