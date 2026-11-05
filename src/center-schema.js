/* مخطط نظام المركز: أسماء الحقول وقوائمها كما قُرئت من نماذجه (بلا أي بيانات أشخاص).
   مصدره tools/ksach-forms.js؛ يُعاد توليده إن تغيّرت نماذج النظام. */
(function (App) {
  App.centerSchema = {
  "createStudent": {
    "action": "/admin/students",
    "page": "/admin/students/create",
    "fields": [
      {
        "name": "track_id",
        "label": "المسار",
        "type": "select",
        "required": true,
        "options": [
          {
            "v": "2",
            "t": "مسار التجميل النسائي - كوافير"
          },
          {
            "v": "8",
            "t": "مسار الترجمة والعمل الحر الرقمي"
          },
          {
            "v": "6",
            "t": "مسار التسويق الرقمي"
          },
          {
            "v": "5",
            "t": "مسار التصميم الجرافيكي"
          },
          {
            "v": "3",
            "t": "مسار التطريز والخياطة"
          },
          {
            "v": "1",
            "t": "مسار الحلاقة الرجالية"
          },
          {
            "v": "7",
            "t": "مسار المساعد الافتراضي وإدارة الأعمال عن بعد"
          },
          {
            "v": "4",
            "t": "مسار صناعة الاكسسوارات والأشغال اليدوية"
          }
        ]
      },
      {
        "name": "student_number",
        "label": "يولد تلقائياً عند تركه فارغاً",
        "type": "text",
        "required": false
      },
      {
        "name": "status",
        "label": "حالة الطالب",
        "type": "select",
        "required": true,
        "options": [
          {
            "v": "active",
            "t": "نشط"
          },
          {
            "v": "under_review",
            "t": "قيد المراجعة"
          },
          {
            "v": "withdrawn",
            "t": "منسحب"
          },
          {
            "v": "graduated",
            "t": "متخرج"
          },
          {
            "v": "suspended",
            "t": "موقوف"
          }
        ]
      },
      {
        "name": "full_name",
        "label": "الاسم الرباعي",
        "type": "text",
        "required": true
      },
      {
        "name": "national_id",
        "label": "رقم الهوية",
        "type": "text",
        "required": true
      },
      {
        "name": "gender",
        "label": "الجنس",
        "type": "select",
        "required": true,
        "options": [
          {
            "v": "male",
            "t": "ذكر"
          },
          {
            "v": "female",
            "t": "أنثى"
          }
        ]
      },
      {
        "name": "marital_status",
        "label": "الحالة الاجتماعية",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "husband",
            "t": "الزوج"
          },
          {
            "v": "single",
            "t": "أعزب"
          },
          {
            "v": "widow",
            "t": "أرملة"
          },
          {
            "v": "divorced",
            "t": "مطلقة"
          },
          {
            "v": "other",
            "t": "أخرى"
          }
        ]
      },
      {
        "name": "phone_1",
        "label": "رقم تواصل 1",
        "type": "text",
        "required": true
      },
      {
        "name": "phone_2",
        "label": "رقم تواصل 2",
        "type": "text",
        "required": false
      },
      {
        "name": "birth_date",
        "label": "تاريخ الميلاد",
        "type": "date",
        "required": false
      },
      {
        "name": "health_status",
        "label": "الوضع الصحي",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "healthy",
            "t": "سليم / سليمة"
          },
          {
            "v": "disabled",
            "t": "ذوي إعاقة"
          }
        ]
      },
      {
        "name": "governorate_id",
        "label": "المحافظة الحالية",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "5",
            "t": "الشمال"
          },
          {
            "v": "3",
            "t": "الوسطى"
          },
          {
            "v": "2",
            "t": "خانيونس"
          },
          {
            "v": "1",
            "t": "رفح"
          },
          {
            "v": "4",
            "t": "غزة"
          }
        ]
      },
      {
        "name": "population_community_id",
        "label": "التجمع السكاني",
        "type": "select",
        "required": false,
        "options": []
      },
      {
        "name": "displacement_status",
        "label": "الإقامة",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "resident",
            "t": "مقيم"
          },
          {
            "v": "displaced",
            "t": "نازح"
          }
        ]
      },
      {
        "name": "residence_type_id",
        "label": "مكان الإقامة الحالي",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "3",
            "t": "خيمة"
          },
          {
            "v": "2",
            "t": "مخيم إيواء"
          },
          {
            "v": "1",
            "t": "منزل"
          }
        ]
      },
      {
        "name": "current_address",
        "label": "عنوان السكن الحالي بالتفصيل",
        "type": "textarea",
        "required": false
      },
      {
        "name": "family_members_count",
        "label": "عدد أفراد الأسرة",
        "type": "number",
        "required": false
      },
      {
        "name": "breadwinner_status",
        "label": "معيل الأسرة",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "husband",
            "t": "الزوج"
          },
          {
            "v": "single",
            "t": "أعزب"
          },
          {
            "v": "widow",
            "t": "أرملة"
          },
          {
            "v": "divorced",
            "t": "مطلقة"
          },
          {
            "v": "other",
            "t": "أخرى"
          }
        ]
      },
      {
        "name": "employment_status",
        "label": "حالة العمل",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "employed",
            "t": "يعمل / تعمل"
          },
          {
            "v": "unemployed",
            "t": "لا يعمل / لا تعمل"
          }
        ]
      },
      {
        "name": "income_type_id",
        "label": "مستوى الدخل",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "2",
            "t": "أقل من 500 شيكل"
          },
          {
            "v": "4",
            "t": "أكثر من 1000 شيكل"
          },
          {
            "v": "1",
            "t": "معدوم الدخل"
          },
          {
            "v": "3",
            "t": "من 500 شيكل حتى 1000 شيكل"
          }
        ]
      },
      {
        "name": "education_level",
        "label": "المستوى التعليمي",
        "type": "select",
        "required": false,
        "options": [
          {
            "v": "none",
            "t": "بدون"
          },
          {
            "v": "preparatory",
            "t": "شهادة ثالث إعدادي"
          },
          {
            "v": "secondary",
            "t": "ثانوية عامة"
          },
          {
            "v": "diploma",
            "t": "دبلوم"
          },
          {
            "v": "bachelor",
            "t": "بكالوريوس"
          },
          {
            "v": "master_or_above",
            "t": "ماجستير فأعلى"
          }
        ]
      },
      {
        "name": "specialization",
        "label": "التخصص",
        "type": "text",
        "required": false
      },
      {
        "name": "notes",
        "label": "ملاحظات",
        "type": "textarea",
        "required": false
      }
    ]
  },
  "studentFilters": {
    "page": "/admin/students",
    "fields": [
      {
        "name": "q",
        "label": "رقم الطالب / الاسم / الهوية / الجوال",
        "type": "text"
      },
      {
        "name": "track_id",
        "label": "المسار",
        "type": "select",
        "options": [
          {
            "v": "",
            "t": "كل المسارات"
          },
          {
            "v": "2",
            "t": "مسار التجميل النسائي - كوافير"
          },
          {
            "v": "8",
            "t": "مسار الترجمة والعمل الحر الرقمي"
          },
          {
            "v": "6",
            "t": "مسار التسويق الرقمي"
          },
          {
            "v": "5",
            "t": "مسار التصميم الجرافيكي"
          },
          {
            "v": "3",
            "t": "مسار التطريز والخياطة"
          },
          {
            "v": "1",
            "t": "مسار الحلاقة الرجالية"
          },
          {
            "v": "7",
            "t": "مسار المساعد الافتراضي وإدارة الأعمال عن بعد"
          },
          {
            "v": "4",
            "t": "مسار صناعة الاكسسوارات والأشغال اليدوية"
          }
        ]
      },
      {
        "name": "training_course_id",
        "label": "الدورة التدريبية",
        "type": "select",
        "options": [
          {
            "v": "",
            "t": "كل الدورات"
          },
          {
            "v": "2",
            "t": "مسار التجميل النسائي - كوافير - المرحلة الاولى"
          },
          {
            "v": "3",
            "t": "مسار الترجمة والعمل الحر الرقمي - المرحلة الاولى"
          },
          {
            "v": "4",
            "t": "مسار التطريز والخياطة - المرحلة الاولى"
          },
          {
            "v": "5",
            "t": "مسار الحلاقة الرجالية - المرحلة الاولى"
          },
          {
            "v": "6",
            "t": "مسار صناعة الاكسسوارات والأشغال اليدوية - المرحلة الاولى"
          },
          {
            "v": "12",
            "t": "مسار صناعة الاكسسوارات والأشغال اليدوية - المرحلة الثالثة"
          },
          {
            "v": "13",
            "t": "مسار الحلاقة الرجالية - المرحلة الثالثة"
          },
          {
            "v": "14",
            "t": "مسار التطريز والخياطة - المرحلة الثالثة"
          },
          {
            "v": "15",
            "t": "مسار التجميل النسائي - كوافير - المرحلة الثالثة"
          },
          {
            "v": "16",
            "t": "مسار التسويق الرقمي - المرحلة الثالثة"
          },
          {
            "v": "7",
            "t": "مسار التجميل النسائي - كوافير - المرحلة الثانية"
          },
          {
            "v": "8",
            "t": "مسار التطريز والخياطة - المرحلة الثانية"
          },
          {
            "v": "9",
            "t": "مسار الحلاقة الرجالية - المرحلة الثانية"
          },
          {
            "v": "10",
            "t": "مسار المساعد الافتراضي وإدارة الأعمال عن بعد - المرحلة الثان"
          },
          {
            "v": "11",
            "t": "مسار صناعة الاكسسوارات والأشغال اليدوية - المرحلة الثانية"
          }
        ]
      },
      {
        "name": "status",
        "label": "حالة الطالب",
        "type": "select",
        "options": [
          {
            "v": "",
            "t": "كل الحالات"
          },
          {
            "v": "active",
            "t": "نشط"
          },
          {
            "v": "under_review",
            "t": "قيد المراجعة"
          },
          {
            "v": "withdrawn",
            "t": "منسحب"
          },
          {
            "v": "graduated",
            "t": "متخرج"
          },
          {
            "v": "suspended",
            "t": "موقوف"
          }
        ]
      },
      {
        "name": "group_status",
        "label": "التوزيع",
        "type": "select",
        "options": [
          {
            "v": "",
            "t": "كل الطلاب"
          },
          {
            "v": "assigned",
            "t": "موزع"
          },
          {
            "v": "unassigned",
            "t": "غير موزع"
          }
        ]
      },
      {
        "name": "per_page",
        "label": "عدد النتائج",
        "type": "select",
        "options": [
          {
            "v": "20",
            "t": "20"
          },
          {
            "v": "50",
            "t": "50"
          },
          {
            "v": "100",
            "t": "100"
          },
          {
            "v": "all",
            "t": "عرض الكل"
          }
        ]
      }
    ]
  }
};
})(window.App = window.App || {});
