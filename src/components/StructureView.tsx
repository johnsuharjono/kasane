import { useEffect, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { api } from "../api";
import { asError, type Relation, type RelationStructure } from "../types";
import { Button } from "./Button";

export function StructureView({
  relation,
  sessionId,
}: {
  relation: Relation;
  sessionId: string;
}) {
  const { schema, name } = relation;
  const [revision, setRevision] = useState(0);
  const [structure, setStructure] = useState<RelationStructure>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!!sessionId);

  useEffect(() => {
    if (!sessionId) return;
    let current = true;
    setLoading(true);
    setError("");
    void api
      .structure(sessionId, schema, name)
      .then((value) => {
        if (current) setStructure(value);
      })
      .catch((error: unknown) => {
        if (current) setError(asError(error).message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [sessionId, schema, name, revision]);

  return (
    <div className="structure-view" aria-busy={loading}>
      {sessionId && (
        <div className="structure-actions">
          <Button
            className="quiet small"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={13} aria-hidden="true" />
            Refresh structure
          </Button>
        </div>
      )}
      {loading && <p role="status">Loading structure…</p>}
      {!sessionId && <p>Connect to inspect structure.</p>}
      {error && <p role="alert">{error}</p>}
      {structure && <StructureDetails structure={structure} />}
    </div>
  );
}

function StructureDetails({ structure }: { structure: RelationStructure }) {
  return (
    <>
      {structure.comment && (
        <p className="structure-comment">{structure.comment}</p>
      )}
      <section aria-label="Columns">
        <h2>Columns</h2>
        <table>
          <thead>
            <tr>
              <th className="ordinal">#</th>
              <th>Column</th>
              <th>Type</th>
              <th>Nullable</th>
              <th>Default or generated value</th>
            </tr>
          </thead>
          <tbody>
            {structure.columns.map((column, index) => (
              <tr key={column.name}>
                <td className="ordinal">{index + 1}</td>
                <td>
                  <span className="column-name">{column.name}</span>
                  {column.primaryKey && (
                    <KeyRound
                      size={12}
                      className="pk-icon"
                      aria-label="Primary key"
                    />
                  )}
                  {column.comment && (
                    <div className="structure-comment">{column.comment}</div>
                  )}
                </td>
                <td className="column-type">{column.dataType}</td>
                <td>{column.required ? "Not null" : "Nullable"}</td>
                <td>
                  {column.identity && (
                    <span className="structure-label">
                      Identity {column.identity}
                    </span>
                  )}
                  {column.generatedExpression && (
                    <span className="structure-label">Generated</span>
                  )}
                  <code>
                    {column.generatedExpression ?? column.defaultExpression}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {structure.constraints.length > 0 && (
        <section aria-label="Constraints">
          <h2>Constraints</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {structure.constraints.map((constraint) => (
                <tr key={constraint.name}>
                  <td className="column-name">{constraint.name}</td>
                  <td>
                    <code>{constraint.definition}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {structure.indexes.length > 0 && (
        <section aria-label="Indexes">
          <h2>Indexes</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Method</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {structure.indexes.map((index) => (
                <tr key={index.name}>
                  <td className="column-name">{index.name}</td>
                  <td>
                    {index.method}
                    {!index.valid && (
                      <span className="structure-label">Invalid</span>
                    )}
                  </td>
                  <td>
                    <code>{index.definition}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {structure.viewDefinition && (
        <section aria-label="View definition">
          <h2>View definition</h2>
          <pre>{structure.viewDefinition}</pre>
        </section>
      )}
    </>
  );
}
