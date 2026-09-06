# AutoSense AI – Intelligent Vehicle Service Centre Management System

> **Research Project – Group J26**

AutoSense AI is an AI-powered intelligent vehicle service centre management system designed to improve vehicle service-centre operations through automated monitoring, vehicle damage assessment, predictive maintenance recommendations, and suspicious behaviour detection.

The system combines multiple AI-based components into a unified platform to support service-centre staff and provide customers with clearer, more efficient service information.

---

## 📌 Project Overview

Traditional vehicle service-centre operations often rely heavily on manual inspection, staff observation, and experience-based decision-making. These processes can be time-consuming and may make it difficult to maintain consistent monitoring and assessment across different service activities.

**AutoSense AI** proposes an intelligent system that applies Artificial Intelligence, Computer Vision, Machine Learning, and related technologies to assist with key service-centre activities.

The project consists of four main research components developed by the four members of **Group J26**.

---

## 🎯 Research Components

| Member       | Component                                           | Main Purpose                                                                        |
| ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Member 1** | Real-Time Vehicle & Service Bay Occupancy Detection | Detect vehicles, monitor service-bay occupancy, and support waiting-time prediction |
| **Member 2** | Vehicle Damage Assessment & Severity Estimation     | Detect, localise, classify, and estimate the severity of vehicle damage             |
| **Member 3** | Predictive Maintenance & Service Recommendation     | Predict potential maintenance needs and provide service recommendations             |
| **Member 4** | Suspicious Behaviour & Anomaly Detection            | Detect unusual or suspicious activities within the service-centre environment       |

Each component addresses a different operational challenge while contributing to the overall AutoSense AI platform.

---

## 🧠 Key Research Areas

The project applies several areas of computing and Artificial Intelligence, including:

* Machine Learning
* Deep Learning
* Computer Vision
* Image Processing
* Object Detection
* Image Classification
* Audio / Signal Processing
* Predictive Analytics
* Anomaly Detection
* Data Analysis

---

## 🏗️ Proposed System

At a high level, AutoSense AI receives information from sources such as cameras, vehicle images, vehicle/engine sounds, service records, and operational data.

The individual AI components process the relevant information and provide structured outputs to the service-centre management system.

```text
                    ┌─────────────────────────┐
                    │       AutoSense AI      │
                    │ Intelligent Vehicle     │
                    │ Service Centre System   │
                    └────────────┬────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
          ▼                      ▼                      ▼
 ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
 │ Member 1        │    │ Member 2        │    │ Member 3        │
 │ Occupancy       │    │ Damage          │    │ Predictive      │
 │ Detection       │    │ Assessment      │    │ Maintenance     │
 └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │ Member 4        │
                       │ Anomaly         │
                       │ Detection       │
                       └────────┬─────────┘
                                │
                                ▼
                     ┌────────────────────┐
                     │ Service Centre     │
                     │ Management &       │
                     │ Customer Interface │
                     └────────────────────┘
```

> The architecture will be refined as implementation progresses.

---

# 👥 Group Components

## Member 1 – Real-Time Vehicle & Service Bay Occupancy Detection

This component focuses on monitoring vehicles and service bays within a vehicle service centre.

### Main Functions

* Detect vehicles in real time
* Identify occupied and available service bays
* Monitor changes in bay occupancy
* Consider vehicles moving between different service areas
* Predict customer waiting time using occupancy and queue information
* Improve detection under changing environmental conditions
* Provide occupancy information to relevant service-centre interfaces

### Proposed Technologies

* YOLO11
* Computer Vision
* Machine Learning
* XGBoost for queue/waiting-time prediction

---

## Member 2 – Vehicle Damage Assessment & Severity Estimation

This component focuses on automatically assessing visible vehicle damage using visual analysis, with acoustic analysis considered as an additional inspection source.

### Main Functions

* Detect vehicle damage
* Localise damage regions
* Classify damage types
* Estimate damage severity
* Support assessment of multiple damage regions
* Analyse vehicle/engine sound where applicable
* Generate a structured digital inspection result

### Proposed Workflow

```text
Vehicle Image
     │
     ▼
Image Preprocessing
     │
     ▼
YOLO11 Damage Detection
     │
     ▼
Damage Localisation
     │
     ▼
Damage Classification
     │
     ▼
Severity Estimation
     │
     ├───────────────┐
     │               │
     ▼               ▼
Visual Analysis   Acoustic Analysis
     │               │
     └───────┬───────┘
             ▼
     Digital Inspection
          Result
```

### Proposed Technologies

* YOLO11
* Python
* OpenCV
* Computer Vision
* Image Processing
* Audio / Signal Processing

---

## Member 3 – Predictive Maintenance & Service Recommendation

This component focuses on analysing vehicle and service-related information to identify potential maintenance needs and provide service recommendations.

The recommendations are intended to support technician decision-making rather than replace professional judgement.

### Main Functions

* Analyse relevant vehicle/service data
* Identify potential maintenance requirements
* Predict possible maintenance needs
* Generate service recommendations
* Present recommendations to service-centre staff

---

## Member 4 – Suspicious Behaviour & Anomaly Detection

This component focuses on identifying unusual or potentially suspicious activities within the vehicle service-centre environment.

### Potential Functions

* Detect unusual activities
* Identify unauthorised persons where applicable
* Detect abnormal vehicle-related events
* Identify potential vehicle fire events
* Generate alerts for potentially suspicious or abnormal situations

---

# 🔬 Research & Development Approach

The project follows a research-driven development process:

```text
Research
   ↓
Existing Systems & Related Work
   ↓
Research Gap Identification
   ↓
Requirements
   ↓
Technology Selection
   ↓
Dataset Preparation
   ↓
Model Development
   ↓
System Implementation
   ↓
Testing
   ↓
Evaluation
   ↓
Improvement
   ↓
Final Integration
```

Each member maintains research and implementation evidence for their assigned component.

---

# 📁 Repository Structure

```text
j26-autosense-ai/
│
├── README.md
├── .gitignore
├── .env.example
├── LICENSE
│
├── docs/
│   │
│   ├── architecture/
│   │   ├── overall-system-architecture.png
│   │   ├── overall-system-workflow.png
│   │   ├── component-interaction-diagram.png
│   │   ├── member-1-architecture.png
│   │   ├── member-2-architecture.png
│   │   ├── member-3-architecture.png
│   │   └── member-4-architecture.png
│   │
│   ├── research/
│   │   ├── member-1/
│   │   ├── member-2/
│   │   ├── member-3/
│   │   └── member-4/
│   │
│   └── presentations/
│
├── member-1-occupancy/
│   ├── README.md
│   ├── backend/
│   ├── frontend/
│   ├── model/
│   ├── dataset/
│   ├── notebooks/
│   ├── tests/
│   └── requirements.txt
│
├── member-2-damage-assessment/
│   ├── README.md
│   ├── backend/
│   ├── frontend/
│   ├── model/
│   ├── dataset/
│   ├── notebooks/
│   ├── tests/
│   └── requirements.txt
│
├── member-3-predictive-maintenance/
│   ├── README.md
│   ├── backend/
│   ├── frontend/
│   ├── model/
│   ├── dataset/
│   ├── notebooks/
│   ├── tests/
│   └── requirements.txt
│
├── member-4-anomaly-detection/
│   ├── README.md
│   ├── backend/
│   ├── frontend/
│   ├── model/
│   ├── dataset/
│   ├── notebooks/
│   ├── tests/
│   └── requirements.txt
│
└── shared/
    ├── frontend/
    ├── backend/
    ├── database/
    ├── api/
    └── utils/
```

---

# 📚 Research Evidence

Research evidence is maintained separately for each member to demonstrate the research process and support the identified knowledge gaps, technology choices, implementation decisions, and evaluation.

Each member should maintain:

```text
docs/research/member-X/
│
├── evidence/
│   ├── README.md
│   ├── research-evidence.md
│   ├── implementation-evidence.md
│   └── evaluation-evidence.md
│
├── papers/
├── datasets/
├── existing-systems/
├── comparison-matrix.xlsx
└── research-notes.md
```

### Evidence should cover

**Research Evidence**

* Related research papers
* Existing systems
* Research gaps
* Proposed solution
* Novelty
* Technology selection
* Dataset justification

**Implementation Evidence**

* Implemented features
* Code references
* Screenshots
* Model development
* System integration

**Evaluation Evidence**

* Experiments
* Evaluation metrics
* Results
* Comparisons
* Error analysis
* Improvements

> Research evidence should be updated throughout development rather than created only at the end of the project.

---

# 🛠️ Technologies

The exact technology stack may evolve during research and implementation. Current/proposed technologies include:

| Area                 | Technologies                                         |
| -------------------- | ---------------------------------------------------- |
| AI / Deep Learning   | YOLO11, Machine Learning                             |
| Computer Vision      | OpenCV, image processing                             |
| Programming          | Python                                               |
| Web Application      | To be finalised based on implementation requirements |
| Data Processing      | Python-based data processing                         |
| Audio Analysis       | Audio / signal-processing techniques                 |
| Predictive Analytics | Machine Learning / XGBoost where applicable          |
| Version Control      | Git, GitHub                                          |

Technology selections will be justified based on project requirements, research findings, performance, feasibility, and implementation constraints.

---

# 🌿 Branching Strategy

The project uses a dedicated branch for each research component.

```text
main
│
├── member-1-occupancy
├── member-2-damage-assessment
├── member-3-predictive-maintenance
└── member-4-anomaly-detection
```

### Branch Naming Standard

| Branch                            | Responsible Component           |
| --------------------------------- | ------------------------------- |
| `main`                            | Integrated project              |
| `member-1-occupancy`              | Vehicle & service bay occupancy |
| `member-2-damage-assessment`      | Vehicle damage assessment       |
| `member-3-predictive-maintenance` | Predictive maintenance          |
| `member-4-anomaly-detection`      | Anomaly detection               |

Members should develop their assigned functionality on their respective branches and use Pull Requests when changes are ready for integration.

---

# 🔄 Development Workflow

Each member should follow the same workflow:

```text
1. Research
      ↓
2. Update research evidence
      ↓
3. Define requirements
      ↓
4. Implement feature
      ↓
5. Test
      ↓
6. Evaluate
      ↓
7. Update implementation/evaluation evidence
      ↓
8. Commit changes
      ↓
9. Push branch
      ↓
10. Create Pull Request
      ↓
11. Review
      ↓
12. Merge into main
```

---

# 📊 Evaluation

The project will evaluate both individual AI components and the overall system.

Possible evaluation areas include:

### AI Model Evaluation

* Precision
* Recall
* F1-score
* mAP
* IoU
* Accuracy
* Confusion matrix

The exact metrics will depend on the requirements of each component.

### System Evaluation

* Processing time
* Detection/inference performance
* System usability
* Reliability
* User feedback
* Practical usefulness

Evaluation methods and metrics will be finalised based on each component's research requirements.

---

# 🔐 Security & Data Management

Sensitive configuration information should **never be committed to the repository**.

Examples include:

```text
.env
API keys
Database credentials
JWT secrets
Private credentials
```

Use `.env.example` to document required environment variables without exposing actual values.

Large datasets and trained model weights should also not be committed directly unless there is a clear reason and appropriate storage/licensing arrangement.

---

# 📈 Expected Benefits

AutoSense AI is intended to provide potential benefits to vehicle service centres, technicians, and customers.

### Service Centres

* More efficient monitoring
* Reduced manual workload
* Better operational visibility
* Centralised digital information
* Potentially improved service coordination

### Technicians

* AI-assisted vehicle assessment
* Faster identification of visible damage
* Structured inspection information
* Decision-support information

### Customers

* Clearer vehicle condition information
* Better understanding of detected issues
* Improved visibility of service-centre status
* Potentially reduced waiting uncertainty

---

# 🚀 Future Development

Potential future development includes:

* Improved AI model performance
* Larger and more diverse datasets
* Better environmental robustness
* Improved severity estimation
* Additional acoustic analysis
* Integration between all four components
* Expanded customer-facing functionality
* Real-world service-centre testing
* Further model optimisation

The final implementation will depend on research findings, available datasets, evaluation results, and project constraints.

---

# 👥 Group J26

**Research Project:** AutoSense AI – Intelligent Vehicle Service Centre Management System

**Group:** J26

### Research Components

* Member 1 – Real-Time Vehicle & Service Bay Occupancy Detection
* Member 2 – Vehicle Damage Assessment & Severity Estimation
* Member 3 – Predictive Maintenance & Service Recommendation
* Member 4 – Suspicious Behaviour & Anomaly Detection

---

# 📄 Project Status

> **Status:** Research & Development

The system is under active development. Features, models, datasets, technologies, and evaluation methods may be refined as the research progresses.

---

## 📜 License

This project is developed for academic/research purposes as part of the Group J26 research project.

License details will be added based on the project's final requirements and applicable third-party software/dataset licenses.
