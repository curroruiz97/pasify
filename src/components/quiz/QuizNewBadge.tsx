import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

const QuizNewBadge = () => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const seen = localStorage.getItem("quiz_seen");
    if (seen === "true") setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <span className="absolute -top-1.5 -right-2 px-1.5 py-0.5 text-[8px] font-bold text-white bg-red-500 rounded-full quiz-sparkle leading-none">
      {t("quiz.new")}
    </span>
  );
};

export default QuizNewBadge;
