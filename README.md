# Docu Genie

Yes. What you are describing is essentially a document ingestion + OCR + structured-data extraction system that watches your scanner directory, understands the folder/file structure, sends scanned pages to a vLLM OCR/vision model, and stores the extracted information in a database.



From your screenshot, you already have a vLLM OpenAI-compatible endpoint running on something like:



http://192.168.101.33:8000/v1



and /v1/models is responding, so we can build directly around that.



1. Your scanner structure



I understand your files roughly like this:



Scanner/

│

├── January/

│   ├── 01/

│   │   ├── 02.jpg

│   │   ├── 04.jpg

│   │   └── 07/

│   │       ├── 07.jpg

│   │       ├── 07_01.jpg

│   │       └── 07_02.jpg

│   │

│   ├── 02/

│   │   └── 01.jpg

│   │

│   └── 03/

│       ├── 03.jpg

│       └── ...

│

├── February/

│   └── ...

│

└── March/

    └── ...



But the important rule is:



Single-page document



04.jpg



means:



Reference = 04

Pages = 1

Main page = 04.jpg



Multi-page document



For example:



07/

├── 07.jpg

├── 07_01.jpg

├── 07_02.jpg

└── 07_03.jpg



means:



Reference = 07



Page 1 → 07.jpg       ← MAIN

Page 2 → 07_01.jpg    ← CONTENT

Page 3 → 07_02.jpg    ← CONTENT

Page 4 → 07_03.jpg    ← CONTENT



That distinction is important because we should preserve the document/page relationship in the database.





---



2. Architecture I recommend



I'd build it as:



SCANNER

                    │

                    ▼

             Scanner Directory

                    │

                    ▼

             Folder Scanner

                    │

                    ▼

          Document Grouping Engine

                    │

          ┌─────────┴─────────┐

          │                   │

     Single image        Multi-page folder

          │                   │

          └─────────┬─────────┘

                    ▼

              OCR Queue

                    │

                    ▼

             vLLM Server

          OpenAI-compatible API

                    │

                    ▼

             OCR / Extraction

                    │

                    ▼

          Structured JSON Data

                    │

                    ▼

             PostgreSQL

                    │

          ┌─────────┴─────────┐

          │                   │

      Web Dashboard       Search/API



I'd use:



Python + FastAPI — backend



PostgreSQL — database



Redis — optional job queue



Celery/RQ/Arq — background processing



vLLM — OCR/Vision inference



OpenCV/Pillow — image preprocessing



React/Next.js — frontend



Watchdog — monitor scanner directory





For a first version, we can actually avoid Redis/Celery and make the system considerably simpler.





---



3. Database design



I would not store everything in one table.



Use something like:



documents



documents

────────────────────────────

id

reference

month

scan_date

source_path

document_type

status

created_at

updated_at



Example:



id:           1832

reference:    07

month:        January

scan_date:    2026-01-07

status:       processed



Then:



document_pages



document_pages

────────────────────────────

id

document_id

page_number

file_path

is_main

ocr_text

ocr_status

created_at



Example:



document_id: 1832



page 1

file: /Scanner/January/07/07.jpg

is_main: true



page 2

file: /Scanner/January/07/07_01.jpg

is_main: false



page 3

file: /Scanner/January/07/07_02.jpg

is_main: false



This gives you a very clean relationship:



Document 07

│

├── Page 1  ← main

├── Page 2

├── Page 3

└── Page 4





---



4. OCR data should be separate from the original document



I would also have an extractions table.



extractions

────────────────────────────

id

document_id

field_name

field_value

confidence

source_page

created_at



For example, suppose the scanned document contains:



Name: Ahmed Ben Ali

Reference: 04

Date: 10/08/2026

Amount: 2500.00



The database becomes:



document_id | field       | value

------------|-------------|------------------

124         | name        | Ahmed Ben Ali

124         | reference   | 04

124         | date        | 2026-08-10

124         | amount      | 2500.00



Or, even better, if your document structure is known, store a JSON object:



{

  "reference": "04",

  "name": "Ahmed Ben Ali",

  "date": "2026-08-10",

  "amount": 2500.00

}



in a PostgreSQL JSONB column.





---



5. The processing pipeline



When a new scan arrives:



Scanner

   │

   ▼

Detect new file

   │

   ▼

Wait until file is completely written

   │

   ▼

Determine month/day

   │

   ▼

Determine reference

   │

   ▼

Determine single/multi-page

   │

   ▼

Create document in DB

   │

   ▼

Create page records

   │

   ▼

Send images to vLLM

   │

   ▼

OCR

   │

   ▼

Extract structured information

   │

   ▼

Validate JSON

   │

   ▼

Save to PostgreSQL

   │

   ▼

Mark document COMPLETE





---



6. vLLM integration



Since your screenshot shows a /v1/models endpoint, we can use the OpenAI-compatible API.



Conceptually:



from openai import OpenAI



client = OpenAI(

    base_url="http://192.168.101.33:8000/v1",

    api_key="EMPTY"

)



Then send the scanned image to the vision model.



For example, the model could be instructed:



You are a document OCR and information extraction system.



Read the scanned document carefully.



Return ONLY valid JSON.



Extract:



- reference

- document_date

- name

- address

- amount

- document_type

- other relevant fields



If a field cannot be found, return null.



Do not invent information.



The output should be something like:



{

  "reference": "04",

  "document_date": "2026-08-10",

  "name": "Ahmed Ben Ali",

  "address": "Tunis",

  "amount": 2500.00,

  "document_type": "invoice"

}





---



7. Important: separate OCR from extraction



I recommend two logical stages, even if they use the same model.



Stage 1 — OCR



Extract everything visible:



{

  "text": "..."

}



Stage 2 — structured extraction



Give the OCR result to the model:



Extract these fields:



reference

name

date

address

amount

...



Result:



{

    "reference": "04",

    "name": "...",

    "date": "...",

    "amount": "..."

}



This makes debugging much easier.



If extraction is wrong, you can see whether:



OCR was wrong



or:



OCR was correct but extraction was wrong





---



8. Multi-page documents



This is where your application can become really useful.



For:



07/

    07.jpg

    07_01.jpg

    07_02.jpg



we shouldn't independently create three documents.



Instead:



Document

Reference = 07



Pages

 ├── 1: 07.jpg

 ├── 2: 07_01.jpg

 └── 3: 07_02.jpg



Then OCR each page:



Page 1 → OCR

Page 2 → OCR

Page 3 → OCR



and combine them:



DOCUMENT OCR TEXT



[PAGE 1]

...



[PAGE 2]

...



[PAGE 3]

...



Then perform extraction against the whole document.



This is much better than extracting each page independently.





---



9. Folder parser



The application should have a component like:



class ScannerParser:



    def scan_month(self, month_path):

        ...



    def scan_day(self, day_path):

        ...



    def detect_documents(self, day_path):

        ...



    def detect_pages(self, document_path):

        ...



For example:



def detect_document(path):



    if path.is_file():

        return {

            "reference": path.stem,

            "pages": [path]

        }



    if path.is_dir():

        files = sorted(path.glob("*"))



        return {

            "reference": path.name,

            "pages": files

        }



But we'd want a more robust implementation because scanners often create files temporarily, use .jpg, .jpeg, .png, .tif, .tiff, etc.





---



10. Don't process a file immediately



This is very important with scanners.



When the scanner creates:



04.jpg



the file may exist before scanning is finished.



If your application immediately sends it to vLLM, you can end up processing a partially written image.



Instead:



NEW FILE

   │

   ▼

Wait 2 seconds

   │

   ▼

Check file size

   │

   ▼

Wait

   │

   ▼

Check file size again

   │

   ├── changed → wait

   │

   └── unchanged → process



For multi-page folders, we should similarly wait until the folder appears stable.





---



11. Processing states



Every document should have a state:



DISCOVERED

    ↓

WAITING

    ↓

QUEUED

    ↓

OCR_PROCESSING

    ↓

EXTRACTION_PROCESSING

    ↓

VALIDATING

    ↓

COMPLETED



And if something goes wrong:



FAILED



with:



error_message

retry_count



This will make your dashboard extremely useful.





---



12. Dashboard



I'd build a dashboard like:



╔══════════════════════════════════════════════╗

║              SCANNER OCR SYSTEM              ║

╠══════════════════════════════════════════════╣

║                                              ║

║  Documents today          247                ║

║  Processed                231                ║

║  Processing                11                ║

║  Failed                     5                ║

║                                              ║

╠══════════════════════════════════════════════╣

║ Recent Documents                             ║

║                                              ║

║ REF     DATE        PAGES    STATUS          ║

║ 01      10/08/26      1      ✓               ║

║ 02      10/08/26      3      ✓               ║

║ 04      10/08/26      1      Processing      ║

║ 07      10/08/26      5      ✓               ║

║                                              ║

╚══════════════════════════════════════════════╝



Clicking 07:



Document 07



Pages

────────────────────

Page 1    [IMAGE]

Page 2    [IMAGE]

Page 3    [IMAGE]



Extracted Data

────────────────────

Reference:    07

Name:         Ahmed Ben Ali

Date:         10/08/2026

Amount:       2,500.00



OCR TEXT

────────────────────

...





---



13. Human validation



I strongly recommend adding a review screen.



AI OCR should not automatically be considered 100% correct.



For example:



┌─────────────────────────────────────────────┐

│ SCANNED DOCUMENT                            │

│                                             │

│ [ document image ]      Extracted data      │

│                         ───────────────      │

│                         Name: Ahmed Ben Ali  │

│                         Ref: 04              │

│                         Date: 10/08/2026     │

│                         Amount: 2500         │

│                                             │

│                         [ Edit ] [Approve]  │

└─────────────────────────────────────────────┘



The user can correct an extraction before it becomes final.





---



14. A very useful feature: confidence



Have the model return confidence where possible:



{

  "name": {

    "value": "Ahmed Ben Ali",

    "confidence": 0.97

  },

  "reference": {

    "value": "04",

    "confidence": 0.99

  },

  "amount": {

    "value": "2500.00",

    "confidence": 0.81

  }

}



Then:



97%  Name

99%  Reference

81%  Amount   ⚠ Review



You can automatically send low-confidence documents to the review queue.





---



15. Recommended project structure



I'd organize the backend like this:



scanner-ocr/

│

├── backend/

│   ├── app/

│   │   ├── main.py

│   │   │

│   │   ├── api/

│   │   │   ├── documents.py

│   │   │   ├── search.py

│   │   │   └── dashboard.py

│   │   │

│   │   ├── scanner/

│   │   │   ├── watcher.py

│   │   │   ├── parser.py

│   │   │   └── grouping.py

│   │   │

│   │   ├── ocr/

│   │   │   ├── vllm.py

│   │   │   ├── prompts.py

│   │   │   └── extraction.py

│   │   │

│   │   ├── database/

│   │   │   ├── models.py

│   │   │   ├── database.py

│   │   │   └── repositories.py

│   │   │

│   │   └── workers/

│   │       └── processor.py

│   │

│   └── requirements.txt

│

├── frontend/

│   ├── src/

│   │   ├── pages/

│   │   ├── components/

│   │   └── api/

│   │

│   └── package.json

│

├── storage/

│

├── docker-compose.yml

└── README.md





---



16. One thing I would change in your folder structure



If you control the scanner output, I'd make the structure unambiguous:



Scanner/

└── 2026/

    ├── 01-January/

    │   ├── 01/

    │   ├── 02/

    │   └── 03/

    │

    ├── 02-February/

    │

    └── 08-August/

        └── 10/

            ├── 02.jpg

            ├── 04/

            │   ├── 04.jpg

            │   ├── 04-02.jpg

            │   └── 04-03.jpg

            │

            └── 07.jpg



However, we don't have to change your existing scanner structure. The parser can adapt to what you already have.





---



17. The architecture I'd build for your case



The most important part is this:



┌──────────────────┐

                         │ Scanner Folder   │

                         └────────┬─────────┘

                                  │

                                  ▼

                         ┌──────────────────┐

                         │ Folder Watcher   │

                         └────────┬─────────┘

                                  │

                                  ▼

                         ┌──────────────────┐

                         │ Document Parser  │

                         └────────┬─────────┘

                                  │

                    ┌─────────────┴─────────────┐

                    │                           │

               single page                 multi-page

                    │                           │

                    └─────────────┬─────────────┘

                                  ▼

                         ┌──────────────────┐

                         │   PostgreSQL     │

                         │ Create Document  │

                         └────────┬─────────┘

                                  │

                                  ▼

                         ┌──────────────────┐

                         │    OCR Queue     │

                         └────────┬─────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │       vLLM          │

                       │ Vision/OCR Model    │

                       └──────────┬──────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │ OCR + Extraction    │

                       │       JSON          │

                       └──────────┬──────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │ Validate / Normalize│

                       └──────────┬──────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │     PostgreSQL      │

                       │ Structured Records  │

                       └──────────┬──────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │   Web Dashboard     │

                       └─────────────────────┘



And I would make the system configurable



For example, anYes. What you are describing is essentially a document ingestion + OCR + structured-data extraction system that watches your scanner directory, understands the folder/file structure, sends scanned pages to a vLLM OCR/vision model, and stores the extracted information in a database.



From your screenshot, you already have a vLLM OpenAI-compatible endpoint running on something like:



http://192.168.101.33:8000/v1



and /v1/models is responding, so we can build directly around that.



1. Your scanner structure



I understand your files roughly like this:



Scanner/

│

├── January/

│   ├── 01/

│   │   ├── 02.jpg

│   │   ├── 04.jpg

│   │   └── 07/

│   │       ├── 07.jpg

│   │       ├── 07_01.jpg

│   │       └── 07_02.jpg

│   │

│   ├── 02/

│   │   └── 01.jpg

│   │

│   └── 03/

│       ├── 03.jpg

│       └── ...

│

├── February/

│   └── ...

│

└── March/

    └── ...



But the important rule is:



Single-page document



04.jpg



means:



Reference = 04

Pages = 1

Main page = 04.jpg



Multi-page document



For example:



07/

├── 07.jpg

├── 07_01.jpg

├── 07_02.jpg

└── 07_03.jpg



means:



Reference = 07



Page 1 → 07.jpg       ← MAIN

Page 2 → 07_01.jpg    ← CONTENT

Page 3 → 07_02.jpg    ← CONTENT

Page 4 → 07_03.jpg    ← CONTENT



That distinction is important because we should preserve the document/page relationship in the database.





---



2. Architecture I recommend



I'd build it as:



SCANNER

                    │

                    ▼

             Scanner Directory

                    │

                    ▼

             Folder Scanner

                    │

                    ▼

          Document Grouping Engine

                    │

          ┌─────────┴─────────┐

          │                   │

     Single image        Multi-page folder

          │                   │

          └─────────┬─────────┘

                    ▼

              OCR Queue

                    │

                    ▼

             vLLM Server

          OpenAI-compatible API

                    │

                    ▼

             OCR / Extraction

                    │

                    ▼

          Structured JSON Data

                    │

                    ▼

             PostgreSQL

                    │

          ┌─────────┴─────────┐

          │                   │

      Web Dashboard       Search/API



I'd use:



Python + FastAPI — backend



PostgreSQL — database



Redis — optional job queue



Celery/RQ/Arq — background processing



vLLM — OCR/Vision inference



OpenCV/Pillow — image preprocessing



React/Next.js — frontend



Watchdog — monitor scanner directory





For a first version, we can actually avoid Redis/Celery and make the system considerably simpler.





---



3. Database design



I would not store everything in one table.



Use something like:



documents



documents

────────────────────────────

id

reference

month

scan_date

source_path

document_type

status

created_at

updated_at



Example:



id:           1832

reference:    07

month:        January

scan_date:    2026-01-07

status:       processed



Then:



document_pages



document_pages

────────────────────────────

id

document_id

page_number

file_path

is_main

ocr_text

ocr_status

created_at



Example:



document_id: 1832



page 1

file: /Scanner/January/07/07.jpg

is_main: true



page 2

file: /Scanner/January/07/07_01.jpg

is_main: false



page 3

file: /Scanner/January/07/07_02.jpg

is_main: false



This gives you a very clean relationship:



Document 07

│

├── Page 1  ← main

├── Page 2

├── Page 3

└── Page 4





---



4. OCR data should be separate from the original document



I would also have an extractions table.



extractions

────────────────────────────

id

document_id

field_name

field_value

confidence

source_page

created_at



For example, suppose the scanned document contains:



Name: Ahmed Ben Ali

Reference: 04

Date: 10/08/2026

Amount: 2500.00



The database becomes:



document_id | field       | value

------------|-------------|------------------

124         | name        | Ahmed Ben Ali

124         | reference   | 04

124         | date        | 2026-08-10

124         | amount      | 2500.00



Or, even better, if your document structure is known, store a JSON object:



{

  "reference": "04",

  "name": "Ahmed Ben Ali",

  "date": "2026-08-10",

  "amount": 2500.00

}



in a PostgreSQL JSONB column.





---



5. The processing pipeline



When a new scan arrives:



Scanner

   │

   ▼

Detect new file

   │

   ▼

Wait until file is completely written

   │

   ▼

Determine month/day

   │

   ▼

Determine reference

   │

   ▼

Determine single/multi-page

   │

   ▼

Create document in DB

   │

   ▼

Create page records

   │

   ▼

Send images to vLLM

   │

   ▼

OCR

   │

   ▼

Extract structured information

   │

   ▼

Validate JSON

   │

   ▼

Save to PostgreSQL

   │

   ▼

Mark document COMPLETE





---



6. vLLM integration



Since your screenshot shows a /v1/models endpoint, we can use the OpenAI-compatible API.



Conceptually:



from openai import OpenAI



client = OpenAI(

    base_url="http://192.168.101.33:8000/v1",

    api_key="EMPTY"

)



Then send the scanned image to the vision model.



For example, the model could be instructed:



You are a document OCR and information extraction system.



Read the scanned document carefully.



Return ONLY valid JSON.



Extract:



- reference

- document_date

- name

- address

- amount

- document_type

- other relevant fields



If a field cannot be found, return null.



Do not invent information.



The output should be something like:



{

  "reference": "04",

  "document_date": "2026-08-10",

  "name": "Ahmed Ben Ali",

  "address": "Tunis",

  "amount": 2500.00,

  "document_type": "invoice"

}





---



7. Important: separate OCR from extraction



I recommend two logical stages, even if they use the same model.



Stage 1 — OCR



Extract everything visible:



{

  "text": "..."

}



Stage 2 — structured extraction



Give the OCR result to the model:



Extract these fields:



reference

name

date

address

amount

...



Result:



{

    "reference": "04",

    "name": "...",

    "date": "...",

    "amount": "..."

}



This makes debugging much easier.



If extraction is wrong, you can see whether:



OCR was wrong



or:



OCR was correct but extraction was wrong





---



8. Multi-page documents



This is where your application can become really useful.



For:



07/

    07.jpg

    07_01.jpg

    07_02.jpg



we shouldn't independently create three documents.



Instead:



Document

Reference = 07



Pages

 ├── 1: 07.jpg

 ├── 2: 07_01.jpg

 └── 3: 07_02.jpg



Then OCR each page:



Page 1 → OCR

Page 2 → OCR

Page 3 → OCR



and combine them:



DOCUMENT OCR TEXT



[PAGE 1]

...



[PAGE 2]

...



[PAGE 3]

...



Then perform extraction against the whole document.



This is much better than extracting each page independently.





---



9. Folder parser



The application should have a component like:



class ScannerParser:



    def scan_month(self, month_path):

        ...



    def scan_day(self, day_path):

        ...



    def detect_documents(self, day_path):

        ...



    def detect_pages(self, document_path):

        ...



For example:



def detect_document(path):



    if path.is_file():

        return {

            "reference": path.stem,

            "pages": [path]

        }



    if path.is_dir():

        files = sorted(path.glob("*"))



        return {

            "reference": path.name,

            "pages": files

        }



But we'd want a more robust implementation because scanners often create files temporarily, use .jpg, .jpeg, .png, .tif, .tiff, etc.





---



10. Don't process a file immediately



This is very important with scanners.



When the scanner creates:



04.jpg



the file may exist before scanning is finished.



If your application immediately sends it to vLLM, you can end up processing a partially written image.



Instead:



NEW FILE

   │

   ▼

Wait 2 seconds

   │

   ▼

Check file size

   │

   ▼

Wait

   │

   ▼

Check file size again

   │

   ├── changed → wait

   │

   └── unchanged → process



For multi-page folders, we should similarly wait until the folder appears stable.





---



11. Processing states



Every document should have a state:



DISCOVERED

    ↓

WAITING

    ↓

QUEUED

    ↓

OCR_PROCESSING

    ↓

EXTRACTION_PROCESSING

    ↓

VALIDATING

    ↓

COMPLETED



And if something goes wrong:



FAILED



with:



error_message

retry_count



This will make your dashboard extremely useful.





---



12. Dashboard



I'd build a dashboard like:



╔══════════════════════════════════════════════╗

║              SCANNER OCR SYSTEM              ║

╠══════════════════════════════════════════════╣

║                                              ║

║  Documents today          247                ║

║  Processed                231                ║

║  Processing                11                ║

║  Failed                     5                ║

║                                              ║

╠══════════════════════════════════════════════╣

║ Recent Documents                             ║

║                                              ║

║ REF     DATE        PAGES    STATUS          ║

║ 01      10/08/26      1      ✓               ║

║ 02      10/08/26      3      ✓               ║

║ 04      10/08/26      1      Processing      ║

║ 07      10/08/26      5      ✓               ║

║                                              ║

╚══════════════════════════════════════════════╝



Clicking 07:



Document 07



Pages

────────────────────

Page 1    [IMAGE]

Page 2    [IMAGE]

Page 3    [IMAGE]



Extracted Data

────────────────────

Reference:    07

Name:         Ahmed Ben Ali

Date:         10/08/2026

Amount:       2,500.00



OCR TEXT

────────────────────

...





---



13. Human validation



I strongly recommend adding a review screen.



AI OCR should not automatically be considered 100% correct.



For example:



┌─────────────────────────────────────────────┐

│ SCANNED DOCUMENT                            │

│                                             │

│ [ document image ]      Extracted data      │

│                         ───────────────      │

│                         Name: Ahmed Ben Ali  │

│                         Ref: 04              │

│                         Date: 10/08/2026     │

│                         Amount: 2500         │

│                                             │

│                         [ Edit ] [Approve]  │

└─────────────────────────────────────────────┘



The user can correct an extraction before it becomes final.





---



14. A very useful feature: confidence



Have the model return confidence where possible:



{

  "name": {

    "value": "Ahmed Ben Ali",

    "confidence": 0.97

  },

  "reference": {

    "value": "04",

    "confidence": 0.99

  },

  "amount": {

    "value": "2500.00",

    "confidence": 0.81

  }

}



Then:



97%  Name

99%  Reference

81%  Amount   ⚠ Review



You can automatically send low-confidence documents to the review queue.





---



15. Recommended project structure



I'd organize the backend like this:



scanner-ocr/

│

├── backend/

│   ├── app/

│   │   ├── main.py

│   │   │

│   │   ├── api/

│   │   │   ├── documents.py

│   │   │   ├── search.py

│   │   │   └── dashboard.py

│   │   │

│   │   ├── scanner/

│   │   │   ├── watcher.py

│   │   │   ├── parser.py

│   │   │   └── grouping.py

│   │   │

│   │   ├── ocr/

│   │   │   ├── vllm.py

│   │   │   ├── prompts.py

│   │   │   └── extraction.py

│   │   │

│   │   ├── database/

│   │   │   ├── models.py

│   │   │   ├── database.py

│   │   │   └── repositories.py

│   │   │

│   │   └── workers/

│   │       └── processor.py

│   │

│   └── requirements.txt

│

├── frontend/

│   ├── src/

│   │   ├── pages/

│   │   ├── components/

│   │   └── api/

│   │

│   └── package.json

│

├── storage/

│

├── docker-compose.yml

└── README.md





---



16. One thing I would change in your folder structure



If you control the scanner output, I'd make the structure unambiguous:



Scanner/

└── 2026/

    ├── 01-January/

    │   ├── 01/

    │   ├── 02/

    │   └── 03/

    │

    ├── 02-February/

    │

    └── 08-August/

        └── 10/

            ├── 02.jpg

            ├── 04/

            │   ├── 04.jpg

            │   ├── 04-02.jpg

            │   └── 04-03.jpg

            │

            └── 07.jpg



However, we don't have to change your existing scanner structure. The parser can adapt to what you already have.





---



17. The architecture I'd build for your case



The most important part is this:



┌──────────────────┐

                         │ Scanner Folder   │

                         └────────┬─────────┘

                                  │

                                  ▼

                         ┌──────────────────┐

                         │ Folder Watcher   │

                         └────────┬─────────┘

                                  │

                                  ▼

                         ┌──────────────────┐

                         │ Document Parser  │

                         └────────┬─────────┘

                                  │

                    ┌─────────────┴─────────────┐

                    │                           │

               single page                 multi-page

                    │                           │

                    └─────────────┬─────────────┘

                                  ▼

                         ┌──────────────────┐

                         │   PostgreSQL     │

                         │ Create Document  │

                         └────────┬─────────┘

                                  │

                                  ▼

                         ┌──────────────────┐

                         │    OCR Queue     │

                         └────────┬─────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │       vLLM          │

                       │ Vision/OCR Model    │

                       └──────────┬──────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │ OCR + Extraction    │

                       │       JSON          │

                       └──────────┬──────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │ Validate / Normalize│

                       └──────────┬──────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │     PostgreSQL      │

                       │ Structured Records  │

                       └──────────┬──────────┘

                                  │

                                  ▼

                       ┌─────────────────────┐

                       │   Web Dashboard     │

                       └─────────────────────┘



And I would make the system configurable



For example, an admin page could define:



vLLM URL

────────────────────────

http://192.168.101.33:8000/v1



Model

────────────────────────

your-vllm-model-name



Scanner directory

────────────────────────

D:\Scanner



Database

────────────────────────

PostgreSQL



OCR prompt

────────────────────────

...



Fields to extract

────────────────────────

☑ Reference

☑ Name

☑ Date

☑ Address

☑ Amount

☑ Document type



That way, you don't have to modify Python code every time your document format changes.



The next step I'd recommend is to build the actual MVP: Python/FastAPI + PostgreSQL + folder watcher + your vLLM endpoint, with the parser handling month → day → reference → single-page/multi-page, then a small web dashboard showing OCR results. We can make the extraction fields configurable rather than hard-coding them. admin page could define:



vLLM URL

────────────────────────

http://192.168.101.33:8000/v1



Model

────────────────────────

your-vllm-model-name



Scanner directory

────────────────────────

D:\Scanner



Database

────────────────────────

PostgreSQL



OCR prompt

────────────────────────

...



Fields to extract

────────────────────────

☑ Reference

☑ Name

☑ Date

☑ Address

☑ Amount

☑ Document type



That way, you don't have to modify Python code every time your document format changes.



The next step I'd recommend is to build the actual MVP: Python/FastAPI + PostgreSQL + folder watcher + your vLLM endpoint, with the parser handling month → day → reference → single-page/multi-page, then a small web dashboard showing OCR results. We can make the extraction fields configurable rather than hard-coding them.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9f32591a-231f-4493-b7c5-5804906ed64d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
