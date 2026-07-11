import os
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import spacy

# Load scispaCy model
# BC5CDR has entities for DISEASE and CHEMICAL (Chemical is useful for drug ingredients)
# We fall back to en_core_sci_sm if not present.
try:
    print("Loading scispaCy model: en_ner_bc5cdr_md...")
    nlp = spacy.load("en_ner_bc5cdr_md")
except Exception as e:
    print(f"Warning: Could not load en_ner_bc5cdr_md ({e}). Trying fallback: en_core_sci_sm...")
    try:
        nlp = spacy.load("en_core_sci_sm")
    except Exception as e2:
        print(f"Error: Could not load any scispaCy models ({e2}). NLP features will be disabled.")
        nlp = None

class ScispacyHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/extract':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                text = data.get('text', '')
            except Exception:
                self.send_error(400, "Invalid JSON payload")
                return

            entities = []
            features = {
                "drug": [],
                "dose": [],
                "form": [],
                "org": []
            }

            if nlp and text:
                try:
                    doc = nlp(text)
                    for ent in doc.ents:
                        entities.append({
                            "label": ent.label_,
                            "text": ent.text
                        })
                        
                        # Custom heuristics for classifying entities
                        if ent.label_ == "CHEMICAL":
                            features["drug"].append(ent.text)
                except Exception as ex:
                    print(f"Error during NLP extraction: {ex}")

            # Send response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            response = {
                "entities": entities,
                "features": features
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
        else:
            self.send_error(404, "Not Found")

def run(port=8001):
    server_address = ('', port)
    httpd = HTTPServer(server_address, ScispacyHandler)
    print(f"scispaCy sidecar running on port {port}...")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    print("Stopping scispaCy sidecar...")

if __name__ == '__main__':
    run()
